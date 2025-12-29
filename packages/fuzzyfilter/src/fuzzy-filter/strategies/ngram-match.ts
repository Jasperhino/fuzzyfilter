/**
 * Strategy: N-gram Match
 * 
 * Handles explicit column/operator/value matches from n-gram matching.
 * This is the main strategy that handles most user queries where they're
 * typing column names, operators, or values.
 */

import type { SuggestionStrategy, StrategyContext } from "./interface.ts";
import type { FilterSuggestion } from "../../types/index.ts";
import type {
  MatchMetadata,
  DetectedValues,
  PositionedValueMatch,
} from "../types.ts";
import { getColumns, getColumn } from "../../schema-builder.ts";
import { getOperatorsForType, getOperator } from "../../operators.ts";
import { DataType } from "../../types/index.ts";
import { parseDate, formatDateForDisplay, COMMON_DATE_SUGGESTIONS } from "../../date-parser.ts";
import { detectValueTokens, selectNonOverlappingMatches, toHypothesisValue } from "../engine/helpers.ts";
import {
  createSuggestion,
  createDateSuggestion,
  countForDateFilter,
} from "../engine/suggestion-helpers.ts";
import { SCORING_CONFIG } from "../constants.ts";
import fuzzysort from "fuzzysort";

/**
 * Strategy for handling n-gram matches (explicit column/operator/value matching)
 */
export class NgramMatchStrategy implements SuggestionStrategy {
  constructor(
    private getSchema: () => import("../../types/index.ts").Schema | null,
    private getData: () => Array<Record<string, unknown>>,
    private getValueTrie: () => import("../../types/index.ts").Trie<{
      value: string;
      columnId: import("../../types/index.ts").ColumnId;
      rowCount: number;
    }>,
    private getColumnById: (
      id: import("../../types/index.ts").ColumnId | string
    ) => import("../../types/index.ts").AnyColumnDefinition | null
  ) {}

  canHandle(context: StrategyContext): boolean {
    // This strategy handles cases where we have column, operator, or value matches
    return (
      context.columnScores.size > 0 ||
      context.operatorScores.size > 0 ||
      context.valueScores.size > 0 ||
      (context.parsed.column !== undefined && context.parsed.operator !== undefined)
    );
  }

  generate(context: StrategyContext): FilterSuggestion[] {
    const schema = this.getSchema();
    if (!schema) return [];

    const suggestions: FilterSuggestion[] = [];
    const seenValues = new Set<string>();

    const {
      tokens,
      parsed,
      columnScores,
      operatorScores,
      valueScores,
      contextRowIndices,
      contextAvailableValues,
    } = context;

    // Detect value tokens for argument-aware scoring
    // First, find which tokens are likely used for column matching
    const usedForColumn = this.detectUsedTokensForColumns(columnScores, tokens);
    const detectedValues = detectValueTokens(tokens, usedForColumn);

    // 1. Column suggestions with argument-aware scoring
    suggestions.push(...this.generateColumnSuggestions(
      columnScores,
      operatorScores,
      detectedValues,
      contextAvailableValues,
      contextRowIndices,
      tokens
    ));

    // 2. Operator suggestions
    const usedForOperator = this.detectUsedTokensForOperators(operatorScores, tokens);
    const operatorDetectedValues = detectValueTokens(tokens, usedForOperator);
    suggestions.push(...this.generateOperatorSuggestions(
      operatorScores,
      columnScores,
      operatorDetectedValues,
      contextAvailableValues,
      contextRowIndices,
      tokens
    ));

    // 3. Value suggestions
    suggestions.push(...this.generateValueSuggestions(
      valueScores,
      columnScores,
      operatorScores,
      contextRowIndices,
      tokens
    ));

    // 4. Column + Operator + Value combinations (from parsed input)
    if (parsed.column && parsed.operator) {
      suggestions.push(...this.generateColumnOperatorValueSuggestions(
        parsed,
        tokens,
        contextAvailableValues,
        contextRowIndices,
        seenValues
      ));
    }

    return suggestions;
  }

  /**
   * Detect which tokens are used for column matching
   */
  private detectUsedTokensForColumns(
    columnScores: Map<string, import("../types.ts").ColumnScoreEntry>,
    tokens: import("../../types/index.ts").Token[]
  ): Set<number> {
    const used = new Set<number>();
    for (const [colId, _breakdown] of columnScores) {
      const col = this.getColumnById(colId);
      if (!col) continue;

      // Find token(s) that best match this column
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        const colMatch = fuzzysort.single(token.normalized, col.name.toLowerCase());
        if (colMatch && colMatch.score > -500) {
          used.add(i);
        }
        // Also check aliases
        if (col.aliases) {
          for (const alias of col.aliases) {
            const aliasMatch = fuzzysort.single(token.normalized, alias.toLowerCase());
            if (aliasMatch && aliasMatch.score > -500) {
              used.add(i);
            }
          }
        }
      }
    }
    return used;
  }

  /**
   * Detect which tokens are used for operator matching
   */
  private detectUsedTokensForOperators(
    operatorScores: Map<string, import("../types.ts").OpScoreEntry>,
    tokens: import("../../types/index.ts").Token[]
  ): Set<number> {
    const used = new Set<number>();
    for (const [_key, { operator: opId }] of operatorScores) {
      const opInfo = getOperator(opId);
      // Find token(s) that best match this operator
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        const opMatch = fuzzysort.single(token.normalized, opInfo.id.toLowerCase());
        const labelMatch = fuzzysort.single(token.normalized, opInfo.label.toLowerCase());
        if ((opMatch && opMatch.score > -500) || (labelMatch && labelMatch.score > -500)) {
          used.add(i);
        }
        // Also check aliases
        for (const alias of opInfo.aliases) {
          const aliasMatch = fuzzysort.single(token.normalized, alias.toLowerCase());
          if (aliasMatch && aliasMatch.score > -500) {
            used.add(i);
          }
        }
      }
    }
    return used;
  }

  /**
   * Generate suggestions from column matches
   */
  private generateColumnSuggestions(
    columnScores: Map<string, import("../types.ts").ColumnScoreEntry>,
    operatorScores: Map<string, import("../types.ts").OpScoreEntry>,
    detectedValues: DetectedValues,
    contextAvailableValues: import("../types.ts").ContextAvailableValues | null,
    contextRowIndices: Set<number> | null,
    tokens: import("../../types/index.ts").Token[]
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];

    for (const [colId, colScoreEntry] of columnScores) {
      const col = this.getColumnById(colId);
      if (!col) continue;

      const {
        breakdown: colBreakdown,
        ngram: colNgram,
        matchedTarget: colMatchedTarget,
        matchIndexes: colMatchIndexes,
      } = colScoreEntry;
      const ops = getOperatorsForType(col.type);

      // Get compatible values for this column type, filtered by context availability
      const compatibleValues: (number | Date)[] =
        col.type === DataType.NUMBER
          ? detectedValues.numbers
              .map((n) => n.value)
              .filter((val) => {
                if (!contextAvailableValues) return true;
                return contextAvailableValues.get(col.id)?.numbers.has(val) ?? false;
              })
          : col.type === DataType.DATE
            ? detectedValues.dates
                .map((d) => d.value)
                .filter((val) => {
                  if (!contextAvailableValues) return true;
                  return (
                    contextAvailableValues.get(col.id)?.dates.has(val.getTime()) ?? false
                  );
                })
            : [];

      // If we have 2+ compatible values, prioritize variadic operators
      if (compatibleValues.length >= 2) {
        suggestions.push(
          ...this.generateVariadicSuggestions(
            col,
            colBreakdown,
            colNgram,
            colMatchedTarget,
            colMatchIndexes,
            ops,
            compatibleValues,
            operatorScores,
            contextRowIndices,
            tokens
          )
        );
      } else if (compatibleValues.length === 1) {
        suggestions.push(
          ...this.generateSingleValueSuggestions(
            col,
            colBreakdown,
            colNgram,
            colMatchedTarget,
            colMatchIndexes,
            ops,
            compatibleValues[0]!,
            operatorScores,
            contextRowIndices,
            tokens
          )
        );
      } else {
        suggestions.push(
          ...this.generateNoArgSuggestions(
            col,
            colBreakdown,
            colNgram,
            colMatchedTarget,
            colMatchIndexes,
            ops,
            operatorScores,
            contextRowIndices,
            tokens
          )
        );
      }
    }

    return suggestions;
  }

  /**
   * Generate suggestions for variadic operators with multiple values
   */
  private generateVariadicSuggestions(
    col: import("../../types/index.ts").AnyColumnDefinition,
    colBreakdown: import("../types.ts").ScoreBreakdown,
    colNgram: import("../types.ts").NgramWithMeta,
    colMatchedTarget: string,
    colMatchIndexes: readonly number[] | undefined,
    ops: Array<{ id: import("../../types/index.ts").Operator }>,
    compatibleValues: (number | Date)[],
    operatorScores: Map<string, import("../types.ts").OpScoreEntry>,
    contextRowIndices: Set<number> | null,
    tokens: import("../../types/index.ts").Token[]
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];

    for (const op of ops) {
      const opInfo = getOperator(op.id);
      let valuesUsed = 0;
      let suggestionArgs: import("../../types/index.ts").HypothesisValueType[] | undefined;

      if (opInfo.isVariadic) {
        const minArgs = opInfo.minArguments ?? 1;

        if (minArgs === 2) {
          // Operators like "between" that need exactly 2 values
          valuesUsed = 2;
          // Sort values to ensure start < end
          const sorted = [...compatibleValues].slice(0, 2).sort((a, b) => {
            if (a instanceof Date && b instanceof Date) {
              return a.getTime() - b.getTime();
            }
            return (a as number) - (b as number);
          });
          suggestionArgs = sorted.map(toHypothesisValue);
        } else {
          // Operators like "in"/"nin" that accept any number of values
          valuesUsed = compatibleValues.length;
          suggestionArgs = compatibleValues.map(toHypothesisValue);
        }
      } else if (opInfo.requiresArgument) {
        // Single-value operator - uses first value
        valuesUsed = 1;
        suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
      }

      // Check if this operator was also matched in the input
      const generalKey = op.id;
      const typedKey = `${op.id}:${col.type}`;
      const opMatch = operatorScores.get(typedKey) ?? operatorScores.get(generalKey);

      // Calculate argument coverage bonus
      const argumentCoverageBonus = Math.round(
        (valuesUsed / compatibleValues.length) * SCORING_CONFIG.BONUS.ARGUMENT_COVERAGE
      );
      // Include operator score if the operator was also matched in the input
      const operatorBonus = opMatch ? opMatch.breakdown.adjustedScore : 0;
      const adjustedScore =
        colBreakdown.adjustedScore + argumentCoverageBonus + operatorBonus;

      // Build match metadata for highlighting
      const matchMeta: MatchMetadata = {
        column: {
          inputStart: colNgram.inputStart,
          inputEnd: colNgram.inputEnd,
          inputText: colNgram.text,
          matchedTarget: colMatchedTarget,
          matchIndexes: colMatchIndexes,
          score: colBreakdown.rawScore,
        },
        // Include operator match metadata if the operator was matched
        operator: opMatch?.ngram
          ? {
              inputStart: opMatch.ngram.inputStart,
              inputEnd: opMatch.ngram.inputEnd,
              inputText: opMatch.ngram.text,
              matchedTarget: opMatch.matchedTarget ?? opMatch.matchedAlias ?? op.id,
              matchIndexes: opMatch.matchIndexes,
              score: opMatch.breakdown.rawScore,
            }
          : undefined,
      };

      suggestions.push(
        createSuggestion(
          col,
          op.id,
          suggestionArgs,
          adjustedScore,
          undefined,
          opMatch?.matchedAlias,
          matchMeta,
          tokens
        )
      );
    }

    return suggestions;
  }

  /**
   * Generate suggestions for single value
   */
  private generateSingleValueSuggestions(
    col: import("../../types/index.ts").AnyColumnDefinition,
    colBreakdown: import("../types.ts").ScoreBreakdown,
    colNgram: import("../types.ts").NgramWithMeta,
    colMatchedTarget: string,
    colMatchIndexes: readonly number[] | undefined,
    ops: Array<{ id: import("../../types/index.ts").Operator }>,
    firstVal: number | Date,
    operatorScores: Map<string, import("../types.ts").OpScoreEntry>,
    contextRowIndices: Set<number> | null,
    tokens: import("../../types/index.ts").Token[]
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const argValue = toHypothesisValue(firstVal);

    for (const op of ops.slice(0, 5)) {
      const opInfo = getOperator(op.id);
      if (!opInfo.requiresArgument) continue;

      // Check if this operator was also matched in the input
      const generalKey = op.id;
      const typedKey = `${op.id}:${col.type}`;
      const opMatch = operatorScores.get(typedKey) ?? operatorScores.get(generalKey);

      // Full coverage bonus since only 1 value
      // Include operator score if the operator was also matched in the input
      const operatorBonus = opMatch ? opMatch.breakdown.adjustedScore : 0;
      const adjustedScore =
        colBreakdown.adjustedScore + SCORING_CONFIG.BONUS.ARGUMENT_COVERAGE + operatorBonus;

      // Build match metadata for highlighting
      const matchMeta: MatchMetadata = {
        column: {
          inputStart: colNgram.inputStart,
          inputEnd: colNgram.inputEnd,
          inputText: colNgram.text,
          matchedTarget: colMatchedTarget,
          matchIndexes: colMatchIndexes,
          score: colBreakdown.rawScore,
        },
        // Include operator match metadata if the operator was matched
        operator: opMatch?.ngram
          ? {
              inputStart: opMatch.ngram.inputStart,
              inputEnd: opMatch.ngram.inputEnd,
              inputText: opMatch.ngram.text,
              matchedTarget: opMatch.matchedTarget ?? opMatch.matchedAlias ?? op.id,
              matchIndexes: opMatch.matchIndexes,
              score: opMatch.breakdown.rawScore,
            }
          : undefined,
      };

      suggestions.push(
        createSuggestion(
          col,
          op.id,
          [argValue],
          adjustedScore,
          undefined,
          opMatch?.matchedAlias,
          matchMeta,
          tokens
        )
      );
    }

    return suggestions;
  }

  /**
   * Generate suggestions for no-argument operators
   */
  private generateNoArgSuggestions(
    col: import("../../types/index.ts").AnyColumnDefinition,
    colBreakdown: import("../types.ts").ScoreBreakdown,
    colNgram: import("../types.ts").NgramWithMeta,
    colMatchedTarget: string,
    colMatchIndexes: readonly number[] | undefined,
    ops: Array<{ id: import("../../types/index.ts").Operator }>,
    operatorScores: Map<string, import("../types.ts").OpScoreEntry>,
    contextRowIndices: Set<number> | null,
    tokens: import("../../types/index.ts").Token[]
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];

    // First, check if any no-argument operators for this column were matched in operatorScores
    const noArgOps = ops.filter((op) => !getOperator(op.id).requiresArgument);
    const matchedNoArgOps: Array<{
      opId: import("../../types/index.ts").Operator;
      opBreakdown: import("../types.ts").ScoreBreakdown;
      matchedAlias?: string;
      opNgram?: import("../types.ts").NgramWithMeta;
      opMatchedTarget?: string;
      opMatchIndexes?: readonly number[];
    }> = [];

    for (const op of noArgOps) {
      // Check if this operator was matched (with or without type restriction)
      const generalKey = op.id;
      const typedKey = `${op.id}:${col.type}`;

      const generalMatch = operatorScores.get(generalKey);
      const typedMatch = operatorScores.get(typedKey);
      const match = typedMatch ?? generalMatch;

      if (match) {
        matchedNoArgOps.push({
          opId: op.id,
          opBreakdown: match.breakdown,
          matchedAlias: match.matchedAlias,
          opNgram: match.ngram,
          opMatchedTarget: match.matchedTarget,
          opMatchIndexes: match.matchIndexes,
        });
      }
    }

    // If we have matched no-argument operators, give them a combined score + completeness bonus
    if (matchedNoArgOps.length > 0) {
      for (const {
        opId,
        opBreakdown,
        matchedAlias,
        opNgram,
        opMatchedTarget,
        opMatchIndexes,
      } of matchedNoArgOps) {
        // Combine column + operator scores, plus completeness bonus
        const combinedScore =
          colBreakdown.adjustedScore +
          opBreakdown.adjustedScore +
          SCORING_CONFIG.BONUS.ARGUMENT_COVERAGE;

        // Build match metadata for highlighting (both column and operator matched)
        const matchMeta: MatchMetadata = {
          column: {
            inputStart: colNgram.inputStart,
            inputEnd: colNgram.inputEnd,
            inputText: colNgram.text,
            matchedTarget: colMatchedTarget,
            matchIndexes: colMatchIndexes,
            score: colBreakdown.rawScore,
          },
          operator: opNgram
            ? {
                inputStart: opNgram.inputStart,
                inputEnd: opNgram.inputEnd,
                inputText: opNgram.text,
                matchedTarget: opMatchedTarget ?? matchedAlias ?? opId,
                matchIndexes: opMatchIndexes,
                score: opBreakdown.rawScore,
              }
            : undefined,
        };

        suggestions.push(
          createSuggestion(
            col,
            opId,
            undefined,
            combinedScore,
            undefined,
            matchedAlias,
            matchMeta,
            tokens
          )
        );
      }

      // Also add other operators with just column score (lower priority)
      for (const op of ops.slice(0, 3)) {
        // Skip if already added as matched no-arg operator
        if (matchedNoArgOps.some((m) => m.opId === op.id)) continue;

        const matchMeta: MatchMetadata = {
          column: {
            inputStart: colNgram.inputStart,
            inputEnd: colNgram.inputEnd,
            inputText: colNgram.text,
            matchedTarget: colMatchedTarget,
            matchIndexes: colMatchIndexes,
            score: colBreakdown.rawScore,
          },
        };

        suggestions.push(
          createSuggestion(
            col,
            op.id,
            undefined,
            colBreakdown.adjustedScore,
            undefined,
            undefined,
            matchMeta,
            tokens
          )
        );
      }
    } else {
      // Fall back to default behavior - suggest top operators with just column score
      for (const op of ops.slice(0, 3)) {
        const matchMeta: MatchMetadata = {
          column: {
            inputStart: colNgram.inputStart,
            inputEnd: colNgram.inputEnd,
            inputText: colNgram.text,
            matchedTarget: colMatchedTarget,
            matchIndexes: colMatchIndexes,
            score: colBreakdown.rawScore,
          },
        };

        suggestions.push(
          createSuggestion(
            col,
            op.id,
            undefined,
            colBreakdown.adjustedScore,
            undefined,
            undefined,
            matchMeta,
            tokens
          )
        );
      }
    }

    return suggestions;
  }

  /**
   * Generate suggestions from operator matches
   */
  private generateOperatorSuggestions(
    operatorScores: Map<string, import("../types.ts").OpScoreEntry>,
    columnScores: Map<string, import("../types.ts").ColumnScoreEntry>,
    operatorDetectedValues: DetectedValues,
    contextAvailableValues: import("../types.ts").ContextAvailableValues | null,
    contextRowIndices: Set<number> | null,
    tokens: import("../../types/index.ts").Token[]
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const schema = this.getSchema();
    if (!schema) return [];

    for (const [
      _key,
      {
        breakdown: opBreakdown,
        operator,
        forType,
        matchedAlias,
        ngram: opNgram,
        matchedTarget: opMatchedTarget,
        matchIndexes: opMatchIndexes,
      },
    ] of operatorScores) {
      const opInfo = getOperator(operator);
      for (const col of getColumns(schema)) {
        // Skip if this is a type-specific alias that doesn't match the column type
        if (forType && forType !== col.type) continue;

        if (opInfo.supportedTypes.includes(col.type)) {
          // Check if this column was also matched in columnScores
          const colMatchEntry = columnScores.get(col.id as string);

          if (colMatchEntry && !opInfo.requiresArgument) {
            // Both column and no-argument operator matched - use combined score
            const combinedScore =
              colMatchEntry.breakdown.adjustedScore +
              opBreakdown.adjustedScore +
              SCORING_CONFIG.BONUS.ARGUMENT_COVERAGE;

            const matchMeta: MatchMetadata = {
              column: {
                inputStart: colMatchEntry.ngram.inputStart,
                inputEnd: colMatchEntry.ngram.inputEnd,
                inputText: colMatchEntry.ngram.text,
                matchedTarget: colMatchEntry.matchedTarget,
                matchIndexes: colMatchEntry.matchIndexes,
                score: colMatchEntry.breakdown.rawScore,
              },
              operator: {
                inputStart: opNgram.inputStart,
                inputEnd: opNgram.inputEnd,
                inputText: opNgram.text,
                matchedTarget: opMatchedTarget,
                matchIndexes: opMatchIndexes,
                score: opBreakdown.rawScore,
              },
            };

            suggestions.push(
              createSuggestion(
                col,
                operator,
                undefined,
                combinedScore,
                undefined,
                matchedAlias,
                matchMeta,
                tokens
              )
            );
          } else if (colMatchEntry && opInfo.requiresArgument) {
            // Both column and operator matched, but operator requires arguments
            const combinedScore =
              colMatchEntry.breakdown.adjustedScore +
              opBreakdown.adjustedScore +
              SCORING_CONFIG.BONUS.ARGUMENT_COVERAGE;

            const matchMeta: MatchMetadata = {
              column: {
                inputStart: colMatchEntry.ngram.inputStart,
                inputEnd: colMatchEntry.ngram.inputEnd,
                inputText: colMatchEntry.ngram.text,
                matchedTarget: colMatchEntry.matchedTarget,
                matchIndexes: colMatchEntry.matchIndexes,
                score: colMatchEntry.breakdown.rawScore,
              },
              operator: {
                inputStart: opNgram.inputStart,
                inputEnd: opNgram.inputEnd,
                inputText: opNgram.text,
                matchedTarget: opMatchedTarget,
                matchIndexes: opMatchIndexes,
                score: opBreakdown.rawScore,
              },
            };

            suggestions.push(
              createSuggestion(
                col,
                operator,
                undefined,
                combinedScore,
                undefined,
                matchedAlias,
                matchMeta,
                tokens
              )
            );
          } else if (opInfo.requiresArgument && !colMatchEntry) {
            // Operator matched but no column matched - check for compatible detected values
            const compatibleValues: (number | Date)[] =
              col.type === DataType.NUMBER
                ? operatorDetectedValues.numbers
                    .map((n) => n.value)
                    .filter((val) => {
                      if (!contextAvailableValues) return true;
                      return (
                        contextAvailableValues.get(col.id)?.numbers.has(val) ?? false
                      );
                    })
                : col.type === DataType.DATE
                  ? operatorDetectedValues.dates
                      .map((d) => d.value)
                      .filter((val) => {
                        if (!contextAvailableValues) return true;
                        return (
                          contextAvailableValues.get(col.id)?.dates.has(val.getTime()) ??
                          false
                        );
                      })
                  : [];

            if (compatibleValues.length >= 1) {
              let valuesUsed = 0;
              let suggestionArgs: import("../../types/index.ts").HypothesisValueType[] | undefined;

              if (opInfo.isVariadic) {
                const minArgs = opInfo.minArguments ?? 1;

                if (minArgs === 2) {
                  // Operators like "between" that need exactly 2 values
                  if (compatibleValues.length >= 2) {
                    valuesUsed = 2;
                    const sorted = [...compatibleValues].slice(0, 2).sort((a, b) => {
                      if (a instanceof Date && b instanceof Date) {
                        return a.getTime() - b.getTime();
                      }
                      return (a as number) - (b as number);
                    });
                    suggestionArgs = sorted.map(toHypothesisValue);
                  } else if (compatibleValues.length === 1) {
                    valuesUsed = 1;
                    suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
                  }
                } else {
                  // Operators like "in"/"nin" that accept any number of values (min 1)
                  valuesUsed = compatibleValues.length;
                  suggestionArgs = compatibleValues.map(toHypothesisValue);
                }
              } else {
                // Single-value operator - uses first value
                valuesUsed = 1;
                suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
              }

              if (valuesUsed > 0 && suggestionArgs) {
                const argumentCoverageBonus = Math.round(
                  (valuesUsed / compatibleValues.length) *
                    SCORING_CONFIG.BONUS.ARGUMENT_COVERAGE
                );
                const adjustedScore = opBreakdown.adjustedScore + argumentCoverageBonus;

                const matchMeta: MatchMetadata = {
                  operator: {
                    inputStart: opNgram.inputStart,
                    inputEnd: opNgram.inputEnd,
                    inputText: opNgram.text,
                    matchedTarget: opMatchedTarget,
                    matchIndexes: opMatchIndexes,
                    score: opBreakdown.rawScore,
                  },
                };

                suggestions.push(
                  createSuggestion(
                    col,
                    operator,
                    suggestionArgs,
                    adjustedScore,
                    undefined,
                    matchedAlias,
                    matchMeta,
                    tokens
                  )
                );
              }
            }

            // Also create incomplete suggestion
            const opOnlyMeta: MatchMetadata = {
              operator: {
                inputStart: opNgram.inputStart,
                inputEnd: opNgram.inputEnd,
                inputText: opNgram.text,
                matchedTarget: opMatchedTarget,
                matchIndexes: opMatchIndexes,
                score: opBreakdown.rawScore,
              },
            };
            suggestions.push(
              createSuggestion(
                col,
                operator,
                undefined,
                opBreakdown.adjustedScore,
                undefined,
                matchedAlias,
                opOnlyMeta,
                tokens
              )
            );
          } else {
            // Only operator matched
            const opOnlyMeta: MatchMetadata = {
              operator: {
                inputStart: opNgram.inputStart,
                inputEnd: opNgram.inputEnd,
                inputText: opNgram.text,
                matchedTarget: opMatchedTarget,
                matchIndexes: opMatchIndexes,
                score: opBreakdown.rawScore,
              },
            };
            suggestions.push(
              createSuggestion(
                col,
                operator,
                undefined,
                opBreakdown.adjustedScore,
                undefined,
                matchedAlias,
                opOnlyMeta,
                tokens
              )
            );
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * Generate suggestions from value matches
   */
  private generateValueSuggestions(
    valueScores: Map<string, import("../types.ts").ValScoreEntry>,
    columnScores: Map<string, import("../types.ts").ColumnScoreEntry>,
    operatorScores: Map<string, import("../types.ts").OpScoreEntry>,
    contextRowIndices: Set<number> | null,
    tokens: import("../../types/index.ts").Token[]
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];

    for (const [
      _key,
      {
        breakdown,
        match,
        ngram: valNgram,
        matchedTarget: valMatchedTarget,
        matchIndexes: valMatchIndexes,
      },
    ] of valueScores) {
      const col = this.getColumnById(match.value.columnId);
      if (col) {
        // When there's a filter context, don't use pre-indexed rowCount - compute dynamically
        const rowCount =
          contextRowIndices !== null ? undefined : match.value.rowCount;

        // Check if this value's column also has a matching column score
        const colEntry = columnScores.get(col.id);
        const opEntry = operatorScores.get("eq");

        // Check if the value's ngram matches a NON-EQ operator better than the value itself
        let anotherOpMatchesBetter = false;
        for (const [, opScoreEntry] of operatorScores) {
          if (opScoreEntry.operator === "eq") continue;

          const opNgram = opScoreEntry.ngram;
          const valueNgram = valNgram;

          const overlaps =
            !(
              opNgram.inputEnd <= valueNgram.inputStart ||
              valueNgram.inputEnd <= opNgram.inputStart
            );

          if (overlaps) {
            const opScore = opScoreEntry.breakdown.adjustedScore;
            const valueScore = breakdown.adjustedScore;

            if (opScore > valueScore) {
              anotherOpMatchesBetter = true;
              break;
            }
          }
        }

        // Determine which operator to use for this value suggestion
        let bestOpForValue: import("../../types/index.ts").Operator = "eq";
        let bestOpEntry: import("../types.ts").OpScoreEntry | undefined = opEntry;

        for (const [, opScoreEntry] of operatorScores) {
          const opInfo = getOperator(opScoreEntry.operator);
          if (
            opInfo.supportedTypes.includes(col.type) &&
            opInfo.requiresArgument
          ) {
            if (
              !bestOpEntry ||
              opScoreEntry.breakdown.adjustedScore > bestOpEntry.breakdown.adjustedScore
            ) {
              bestOpEntry = opScoreEntry;
              bestOpForValue = opScoreEntry.operator;
            }
          }
        }

        // Calculate combined score when column and operator also matched
        let finalScore = breakdown.adjustedScore;
        if (!anotherOpMatchesBetter && (colEntry || bestOpEntry)) {
          const colBonus = colEntry ? colEntry.breakdown.adjustedScore : 0;
          const opBonus = bestOpEntry ? bestOpEntry.breakdown.adjustedScore : 0;
          finalScore = breakdown.adjustedScore + colBonus + opBonus;
        }

        // Build match metadata for highlighting (value matched)
        const matchMeta: MatchMetadata = {
          column: colEntry
            ? {
                inputStart: colEntry.ngram.inputStart,
                inputEnd: colEntry.ngram.inputEnd,
                inputText: colEntry.ngram.text,
                matchedTarget: colEntry.matchedTarget,
                matchIndexes: colEntry.matchIndexes,
                score: colEntry.breakdown.rawScore,
              }
            : undefined,
          operator: bestOpEntry
            ? {
                inputStart: bestOpEntry.ngram.inputStart,
                inputEnd: bestOpEntry.ngram.inputEnd,
                inputText: bestOpEntry.ngram.text,
                matchedTarget: bestOpEntry.matchedTarget,
                matchIndexes: bestOpEntry.matchIndexes,
                score: bestOpEntry.breakdown.rawScore,
              }
            : undefined,
          values: [
            {
              inputStart: valNgram.inputStart,
              inputEnd: valNgram.inputEnd,
              inputText: valNgram.text,
              matchedTarget: valMatchedTarget,
              matchIndexes: valMatchIndexes,
              score: breakdown.rawScore,
            },
          ],
        };

        suggestions.push(
          createSuggestion(
            col,
            bestOpForValue,
            [{ kind: "string", value: match.value.value }],
            finalScore,
            rowCount,
            bestOpEntry?.matchedAlias,
            matchMeta,
            tokens
          )
        );
      }
    }

    return suggestions;
  }

  /**
   * Generate suggestions when we have a clear column + operator match
   */
  private generateColumnOperatorValueSuggestions(
    parsed: import("../../types/index.ts").ParsedInput,
    tokens: import("../../types/index.ts").Token[],
    contextAvailableValues: import("../types.ts").ContextAvailableValues | null,
    contextRowIndices: Set<number> | null,
    seenValues: Set<string>
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const col = parsed.column!.match.column;
    const op = parsed.operator!.match.operator;
    const opInfo = getOperator(op);

    if (!opInfo.requiresArgument) {
      // Operator doesn't need value - suggest the complete filter
      suggestions.push(
        createSuggestion(
          col,
          op,
          undefined,
          parsed.column!.match.score + parsed.operator!.match.score,
          undefined,
          undefined,
          undefined,
          tokens
        )
      );
      return suggestions;
    }

    // Get remaining tokens after column and operator as potential value
    const colTokenIdx = tokens.indexOf(parsed.column!.token);
    const opTokenIdx = tokens.indexOf(parsed.operator!.token);
    const valueTokens = tokens.filter(
      (_, i) => i !== colTokenIdx && i !== opTokenIdx
    );

    // Handle date columns specially
    if (col.type === DataType.DATE) {
      if (valueTokens.length > 0) {
        const valueQuery = valueTokens.map((t) => t.text).join(" ");
        const parsedDate = parseDate(valueQuery);

        if (parsedDate) {
          const colToken = parsed.column!.token;
          const opToken = parsed.operator!.token;
          const valueStart = valueTokens[0]?.start ?? 0;
          const valueEnd =
            valueTokens[valueTokens.length - 1]?.end ?? valueQuery.length;
          const isRangeDate =
            parsedDate.rangeStart && parsedDate.rangeEnd && opInfo.isVariadic;

          const dateMatchMeta: MatchMetadata = {
            column: {
              inputStart: colToken.start,
              inputEnd: colToken.end,
              inputText: colToken.text,
              matchedTarget: col.name,
              score: parsed.column!.match.score,
            },
            operator: {
              inputStart: opToken.start,
              inputEnd: opToken.end,
              inputText: opToken.text,
              matchedTarget: opInfo.label,
              score: parsed.operator!.match.score,
            },
            values: isRangeDate
              ? [
                  {
                    inputStart: valueStart,
                    inputEnd: valueEnd,
                    inputText: valueQuery,
                    matchedTarget: formatDateForDisplay(parsedDate.rangeStart!),
                    score: 0,
                  },
                  {
                    inputStart: valueStart,
                    inputEnd: valueEnd,
                    inputText: valueQuery,
                    matchedTarget: formatDateForDisplay(parsedDate.rangeEnd!),
                    score: 0,
                  },
                ]
              : [
                  {
                    inputStart: valueStart,
                    inputEnd: valueEnd,
                    inputText: valueQuery,
                    matchedTarget: formatDateForDisplay(parsedDate.date),
                    score: 0,
                  },
                ],
          };

          const key = `${col.id}:${op}:date:${parsedDate.date.toISOString()}`;
          if (!seenValues.has(key)) {
            seenValues.add(key);
            suggestions.push(
              createDateSuggestion(
                col,
                op,
                parsedDate,
                SCORING_CONFIG.BONUS.DATE_FILTER_COMPLETE - 500, // High score for complete date filter
                countForDateFilter(
                  col.id,
                  op,
                  parsedDate,
                  this.getData(),
                  contextRowIndices
                ),
                undefined,
                dateMatchMeta
              )
            );
          }
        }

        // Also search indexed date values as strings
        const valueQueryNorm = valueTokens.map((t) => t.normalized).join(" ");
        const valMatchesRaw = this.getValueTrie().fuzzySearch(valueQueryNorm, 5);
        const valMatches = contextAvailableValues
          ? valMatchesRaw.filter((match) => {
              const available = contextAvailableValues.get(match.value.columnId);
              return available?.strings.has(match.value.value) ?? false;
            })
          : valMatchesRaw;
        for (const match of valMatches) {
          if (match.value.columnId === col.id) {
            const key = `${col.id}:${op}:${match.value.value}`;
            if (!seenValues.has(key)) {
              seenValues.add(key);
              const rowCount =
                contextRowIndices !== null ? undefined : match.value.rowCount;
              suggestions.push(
                createSuggestion(
                  col,
                  op,
                  [{ kind: "string", value: match.value.value }],
                  match.score + parsed.column!.match.score,
                  rowCount,
                  undefined,
                  undefined,
                  tokens
                )
              );
            }
          }
        }
      } else {
        // No value tokens yet - suggest common date phrases
        const colToken = parsed.column!.token;
        const opToken = parsed.operator!.token;
        const colOpMatchMeta: MatchMetadata = {
          column: {
            inputStart: colToken.start,
            inputEnd: colToken.end,
            inputText: colToken.text,
            matchedTarget: col.name,
            score: parsed.column!.match.score,
          },
          operator: {
            inputStart: opToken.start,
            inputEnd: opToken.end,
            inputText: opToken.text,
            matchedTarget: opInfo.label,
            score: parsed.operator!.match.score,
          },
        };

        for (const dateSuggestion of COMMON_DATE_SUGGESTIONS) {
          const parsedDate = parseDate(dateSuggestion.text);
          if (parsedDate) {
            const key = `${col.id}:${op}:date:${dateSuggestion.text}`;
            if (!seenValues.has(key)) {
              seenValues.add(key);
              suggestions.push(
                createDateSuggestion(
                  col,
                  op,
                  parsedDate,
                  parsed.column!.match.score,
                  countForDateFilter(
                    col.id,
                    op,
                    parsedDate,
                    this.getData(),
                    contextRowIndices
                  ),
                  dateSuggestion.label,
                  colOpMatchMeta
                )
              );
            }
          }
        }
      }
    } else {
      // Non-date columns - handle variadic operators specially
      if (valueTokens.length > 0) {
        if (opInfo.isVariadic && valueTokens.length >= 1) {
          // For variadic operators, search for EACH value token separately
          const tokenMatchInfo: Array<{
            token: import("../../types/index.ts").Token;
            matchedValue: string;
            score: number;
            matchIndexes?: readonly number[];
          } | null> = [];
          const matchedValues: Array<{ value: string; score: number }> = [];

          for (const valueToken of valueTokens) {
            const tokenMatches = this.getValueTrie().fuzzySearch(
              valueToken.normalized,
              3
            );
            const filteredMatches = contextAvailableValues
              ? tokenMatches.filter((match) => {
                  const available = contextAvailableValues.get(match.value.columnId);
                  return available?.strings.has(match.value.value) ?? false;
                })
              : tokenMatches;

            const bestMatch = filteredMatches.find(
              (m) => m.value.columnId === col.id
            );
            if (bestMatch) {
              tokenMatchInfo.push({
                token: valueToken,
                matchedValue: bestMatch.value.value,
                score: bestMatch.score,
                matchIndexes: bestMatch.indexes,
              });
              if (
                !matchedValues.some((v) => v.value === bestMatch.value.value)
              ) {
                matchedValues.push({
                  value: bestMatch.value.value,
                  score: bestMatch.score,
                });
              }
            } else {
              tokenMatchInfo.push(null);
            }
          }

          if (matchedValues.length > 0) {
            const colScore = parsed.column!.match.score;
            const opScore = parsed.operator?.match.score ?? 0;
            const colBonus = colScore >= -100 ? 500 : Math.max(0, 500 + colScore);
            const opBonus = opScore >= -100 ? 500 : Math.max(0, 500 + opScore);
            const avgValScore =
              matchedValues.reduce((sum, v) => sum + v.score, 0) /
              matchedValues.length;
            const valBonus =
              avgValScore >= -100 ? 500 : Math.max(0, 500 + avgValScore);
            const valueCoverageBonus = Math.round(
              (matchedValues.length / valueTokens.length) *
                SCORING_CONFIG.BONUS.VALUE_COVERAGE
            );
            const combinedScore =
              SCORING_CONFIG.BONUS.COMBINED_MATCH_BASE +
              colBonus +
              opBonus +
              valBonus +
              valueCoverageBonus;

            const args: import("../../types/index.ts").HypothesisValueType[] =
              matchedValues.map((v) => ({ kind: "string", value: v.value }));
            const key = `${col.id}:${op}:${matchedValues.map((v) => v.value).join(",")}`;

            const colToken = parsed.column!.token;
            const opToken = parsed.operator!.token;
            const valueMatchEntries = tokenMatchInfo
              .filter(
                (
                  info
                ): info is {
                  token: import("../../types/index.ts").Token;
                  matchedValue: string;
                  score: number;
                  matchIndexes?: readonly number[];
                } => info !== null
              )
              .map((info) => ({
                inputStart: info.token.start,
                inputEnd: info.token.end,
                inputText: info.token.text,
                matchedTarget: info.matchedValue,
                matchIndexes: info.matchIndexes,
                score: info.score,
              }));

            const matchMeta: MatchMetadata = {
              column: {
                inputStart: colToken.start,
                inputEnd: colToken.end,
                inputText: colToken.text,
                matchedTarget: col.name,
                score: colScore,
              },
              operator: {
                inputStart: opToken.start,
                inputEnd: opToken.end,
                inputText: opToken.text,
                matchedTarget: op,
                score: opScore,
              },
              values: valueMatchEntries,
            };

            if (!seenValues.has(key)) {
              seenValues.add(key);
              suggestions.push(
                createSuggestion(
                  col,
                  op,
                  args,
                  combinedScore,
                  undefined,
                  undefined,
                  matchMeta,
                  tokens
                )
              );
            }
          }
        } else {
          // Non-variadic operator: search for single value
          const valueQuery = valueTokens.map((t) => t.normalized).join(" ");
          const valMatchesRaw = this.getValueTrie().fuzzySearch(valueQuery, 10);

          const valMatches = contextAvailableValues
            ? valMatchesRaw.filter((match) => {
                const available = contextAvailableValues.get(match.value.columnId);
                return available?.strings.has(match.value.value) ?? false;
              })
            : valMatchesRaw;

          for (const match of valMatches) {
            if (match.value.columnId === col.id) {
              const colScore = parsed.column!.match.score;
              const opScore = parsed.operator?.match.score ?? 0;
              const colBonus = colScore >= -100 ? 500 : Math.max(0, 500 + colScore);
              const opBonus = opScore >= -100 ? 500 : Math.max(0, 500 + opScore);
              const valBonus = match.score >= -100 ? 500 : Math.max(0, 500 + match.score);
              const combinedScore =
                SCORING_CONFIG.BONUS.COMBINED_MATCH_BASE +
                colBonus +
                opBonus +
                valBonus;
              const key = `${col.id}:${op}:${match.value.value}`;
              if (!seenValues.has(key)) {
                seenValues.add(key);
                const rowCount =
                  contextRowIndices !== null ? undefined : match.value.rowCount;
                suggestions.push(
                  createSuggestion(
                    col,
                    op,
                    [{ kind: "string", value: match.value.value }],
                    combinedScore,
                    rowCount,
                    undefined,
                    undefined,
                    tokens
                  )
                );
              }
            }
          }
        }
      } else {
        // No value tokens yet, suggest all values for this column
        const allValues = this.getValueTrie()
          .entries()
          .filter((e) => e.value.columnId === col.id)
          .filter((e) => {
            if (!contextAvailableValues) return true;
            return (
              contextAvailableValues.get(col.id)?.strings.has(e.value.value) ??
              false
            );
          })
          .slice(0, 10);

        for (const entry of allValues) {
          const key = `${col.id}:${op}:${entry.value.value}`;
          if (!seenValues.has(key)) {
            seenValues.add(key);
            const rowCount =
              contextRowIndices !== null ? undefined : entry.value.rowCount;
            suggestions.push(
              createSuggestion(
                col,
                op,
                [{ kind: "string", value: entry.value.value }],
                parsed.column!.match.score,
                rowCount,
                undefined,
                undefined,
                tokens
              )
            );
          }
        }
      }
    }

    return suggestions;
  }
}
