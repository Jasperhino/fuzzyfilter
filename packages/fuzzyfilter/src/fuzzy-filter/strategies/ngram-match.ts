/**
 * Strategy: N-gram Match
 * 
 * Handles explicit column/operator/value matches from n-gram matching.
 * This is the main strategy that handles most user queries where they're
 * typing column names, operators, or values.
 */

import type { SuggestionStrategy, StrategyContext } from "./interface.ts";
import type { FilterSuggestion, ColumnId } from "../../types/index.ts";
import type {
  MatchMetadata,
  DetectedValues,
  PositionedValueMatch,
} from "../types.ts";
import { getColumns, getColumn } from "../../schema-builder.ts";
import { getAllOperators, getOperator } from "../../operators.ts";
import { DataType } from "../../types/index.ts";
import { parseDate, formatDateForDisplay, getDateSuggestionsForLocale } from "../../date-parser.ts";
import { detectValueTokens, selectNonOverlappingMatches, toHypothesisValue, createTypedValue } from "../engine/helpers.ts";
import {
  createSuggestion,
  createDateSuggestion,
  countForDateFilter,
} from "../engine/suggestion-helpers.ts";
import { SCORING_CONFIG } from "../constants.ts";
import { calculateSmartScore } from "../engine/scorer.ts";
import fuzzysort from "fuzzysort";
import type { OperatorDefinition } from "../../types/index.ts";

// ============================================================================
// OPERATOR PROPERTY HELPERS
// These derive isVariadic/requiresArgument from patterns since these are only
// available on CompiledOperator, not the raw OperatorDefinition.
// ============================================================================

/**
 * Check if an operator is variadic (accepts multiple arguments).
 * Derived from patterns - checks if any pattern has:
 * - A variadic placeholder ({...} or {name...})
 * - 2+ argument placeholders
 */
function isOperatorVariadic(op: OperatorDefinition | undefined): boolean {
  if (!op || !op.patterns) return false;
  
  return op.patterns.some(p => {
    // Check for variadic placeholder syntax: {...} or {name...}
    if (/\{\w*\.\.\.\}/.test(p)) return true;
    // Check for 2+ argument placeholders
    return (p.match(/\{[^}]*\}/g) || []).length >= 2;
  });
}

/**
 * Check if an operator requires an argument.
 * Derived from patterns - checks if any pattern has argument placeholders.
 */
function operatorRequiresArgument(op: OperatorDefinition | undefined): boolean {
  if (!op) return false;
  return op.patterns?.some(p => /\{[^}]*\}/.test(p)) ?? false;
}

/**
 * Get minimum number of arguments for an operator.
 * Derived from the pattern with the fewest argument placeholders.
 */
function getMinArguments(op: OperatorDefinition | undefined): number {
  if (!op || !op.patterns) return 0;
  const counts = op.patterns.map(p => (p.match(/\{[^}]+\}/g) || []).length);
  return Math.min(...counts);
}

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
      id: string
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
    const locale = context.i18nProvider?.locale ?? "en";
    const detectedValues = detectValueTokens(tokens, usedForColumn, locale);

    // 1. Column suggestions with argument-aware scoring
    suggestions.push(...        this.generateColumnSuggestions(
          columnScores,
          operatorScores,
          detectedValues,
          contextAvailableValues,
          contextRowIndices,
          tokens,
          context.i18nProvider
        ));

    // 2. Operator suggestions
    const usedForOperator = this.detectUsedTokensForOperators(operatorScores, tokens, context.i18nProvider);
    const operatorDetectedValues = detectValueTokens(tokens, usedForOperator, locale);
    suggestions.push(...this.generateOperatorSuggestions(
      operatorScores,
      columnScores,
      operatorDetectedValues,
      contextAvailableValues,
      contextRowIndices,
      tokens,
      context.i18nProvider
    ));

    // 3. Value suggestions
    suggestions.push(...this.generateValueSuggestions(
      valueScores,
      columnScores,
      operatorScores,
      contextRowIndices,
      tokens,
      context.i18nProvider
    ));

    // 4. Column + Operator + Value combinations (from parsed input)
    if (parsed.column && parsed.operator) {
      suggestions.push(...        this.generateColumnOperatorValueSuggestions(
          parsed,
          tokens,
          contextAvailableValues,
          contextRowIndices,
          seenValues,
          context.i18nProvider
        ));
    }

    return suggestions;
  }

  /**
   * Detect which tokens are used for column matching.
   * Uses fuzzysort v3 scores (0-1 range, 0.3+ = reasonable match).
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
        const colMatch = fuzzysort.single(token.normalized, col.labelKey.toLowerCase());
        // fuzzysort v3: scores are 0-1, use 0.3 threshold to match trie settings
        if (colMatch && colMatch.score > 0.3) {
          used.add(i);
        }
        // Also check aliases
        if (col.aliases) {
          for (const alias of col.aliases) {
            const aliasMatch = fuzzysort.single(token.normalized, alias.toLowerCase());
            if (aliasMatch && aliasMatch.score > 0.3) {
              used.add(i);
            }
          }
        }
      }
    }
    return used;
  }

  /**
   * Detect which tokens are used for operator matching.
   * Uses fuzzysort v3 scores (0-1 range, 0.3+ = reasonable match).
   */
  private detectUsedTokensForOperators(
    operatorScores: Map<string, import("../types.ts").OpScoreEntry>,
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): Set<number> {
    const used = new Set<number>();
    for (const [_key, { operator: opId }] of operatorScores) {
      const opInfo = getOperator(opId);
      if (!opInfo) continue;
      
      // Find token(s) that best match this operator
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        const opMatch = fuzzysort.single(token.normalized, opInfo.id.toLowerCase());
        // fuzzysort v3: scores are 0-1, use 0.3 threshold to match trie settings
        if (opMatch && opMatch.score > 0.3) {
          used.add(i);
        }
        // Operator aliases are now resolved via i18n provider and matched through the trie,
        // so we don't need to check them here separately
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
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
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
      if (!col.type) continue; // Skip columns without type
      const ops = getAllOperators();

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
          tokens,
          i18nProvider
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
          tokens,
          i18nProvider
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
          tokens,
          i18nProvider
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
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];

    for (const op of ops) {
      const opInfo = getOperator(op.id);
      let valuesUsed = 0;
      let suggestionArgs: import("../../types/index.ts").HypothesisValueType[] | undefined;

      if (isOperatorVariadic(opInfo)) {
        const minArgs = getMinArguments(opInfo) || 1;

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
          suggestionArgs = sorted.map((val) => toHypothesisValue(val));
        } else {
          // Operators like "in"/"nin" that accept any number of values
          valuesUsed = compatibleValues.length;
          suggestionArgs = compatibleValues.map((val) => toHypothesisValue(val));
        }
      } else if (operatorRequiresArgument(opInfo)) {
        // Single-value operator - uses first value
        valuesUsed = 1;
        suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
      }

      // Check if this operator was also matched in the input
      const generalKey = op.id;
      const typedKey = `${op.id}:${col.type}`;
      const opMatch = operatorScores.get(typedKey) ?? operatorScores.get(generalKey);

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
          0, // Score will be calculated by createSuggestion using matchMetadata
          undefined,
          opMatch?.matchedAlias,
          matchMeta,
          tokens,
          i18nProvider
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
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const argValue = toHypothesisValue(firstVal);

    for (const op of ops.slice(0, 5)) {
      const opInfo = getOperator(op.id);
      if (!operatorRequiresArgument(opInfo)) continue;

      // Check if this operator was also matched in the input
      const generalKey = op.id;
      const typedKey = `${op.id}:${col.type}`;
      const opMatch = operatorScores.get(typedKey) ?? operatorScores.get(generalKey);

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
          0, // Score will be calculated by createSuggestion using matchMetadata
          undefined,
          opMatch?.matchedAlias,
          matchMeta,
          tokens,
          i18nProvider
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
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];

    // First, check if any no-argument operators for this column were matched in operatorScores
    const noArgOps = ops.filter((op) => {
      const opInfo = getOperator(op.id);
      return !operatorRequiresArgument(opInfo);
    });
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
            0, // Score will be calculated by createSuggestion using matchMetadata
            undefined,
            matchedAlias,
            matchMeta,
            tokens,
            i18nProvider
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
            tokens,
            i18nProvider
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
            tokens,
            i18nProvider
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
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
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
      if (!opInfo) continue;
      for (const col of getColumns(schema)) {
        // Skip if this is a type-specific alias that doesn't match the column type
        if (forType && forType !== col.type) continue;
        if (!col.type) continue;

        const colMatchEntry = columnScores.get(col.id as string);

        if (colMatchEntry && !operatorRequiresArgument(opInfo)) {
            // Both column and no-argument operator matched
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
                0, // Score will be calculated by createSuggestion using matchMetadata
                undefined,
                matchedAlias,
                matchMeta,
                tokens,
                i18nProvider
              )
            );
          } else if (colMatchEntry && operatorRequiresArgument(opInfo)) {
            // Both column and operator matched, but operator requires arguments
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
                0, // Score will be calculated by createSuggestion using matchMetadata
                undefined,
                matchedAlias,
                matchMeta,
                tokens,
                i18nProvider
              )
            );
          } else if (operatorRequiresArgument(opInfo) && !colMatchEntry) {
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

              if (isOperatorVariadic(opInfo)) {
                const minArgs = getMinArguments(opInfo) || 1;

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
                    suggestionArgs = sorted.map((val) => toHypothesisValue(val));
                  } else if (compatibleValues.length === 1) {
                    valuesUsed = 1;
                    suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
                  }
                } else {
                  // Operators like "in"/"nin" that accept any number of values (min 1)
                  valuesUsed = compatibleValues.length;
                  suggestionArgs = compatibleValues.map((val) => toHypothesisValue(val));
                }
              } else {
                // Single-value operator - uses first value
                valuesUsed = 1;
                suggestionArgs = [toHypothesisValue(compatibleValues[0]!)];
              }

              if (valuesUsed > 0 && suggestionArgs) {
                // Operator-only match (no column match)
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
                    0, // Score will be calculated by createSuggestion using matchMetadata
                    undefined,
                    matchedAlias,
                    matchMeta,
                    tokens,
                    i18nProvider
                  )
                );
              }
            }

            // Also create incomplete suggestion (no value match)
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
                0, // Score will be calculated by createSuggestion using matchMetadata
                undefined,
                matchedAlias,
                opOnlyMeta,
                tokens,
                i18nProvider
              )
            );
          } else {
            // Only operator matched (no column, no value)
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
                0, // Score will be calculated by createSuggestion using matchMetadata
                undefined,
                matchedAlias,
                opOnlyMeta,
                tokens,
                i18nProvider
              )
            );
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
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
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
          if (!opInfo || !col.type) continue;
          // Operators are now universal - no need to check supportedTypes
          if (operatorRequiresArgument(opInfo)) {
            if (
              !bestOpEntry ||
              opScoreEntry.breakdown.adjustedScore > bestOpEntry.breakdown.adjustedScore
            ) {
              bestOpEntry = opScoreEntry;
              bestOpForValue = opScoreEntry.operator;
            }
          }
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
            [createTypedValue(match.value.value, col.type)],
            0, // Score will be calculated by createSuggestion using matchMetadata
            rowCount,
            bestOpEntry?.matchedAlias,
            matchMeta,
            tokens,
            i18nProvider
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
    seenValues: Set<string>,
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const col = parsed.column!.match.column;
    const op = parsed.operator!.match.operator;
    const opInfo = getOperator(op);
    if (!opInfo) return suggestions;

    if (!operatorRequiresArgument(opInfo)) {
      // Operator doesn't need value - suggest the complete filter
      // Normalize raw fuzzysort scores and apply weights
      const colMatch = parsed.column!.match;
      const opMatch = parsed.operator!.match;
      
      // Build match metadata for date suggestions without values
      const colOpMatchMeta: MatchMetadata = {
        column: {
          inputStart: parsed.column!.token.start,
          inputEnd: parsed.column!.token.end,
          inputText: parsed.column!.token.text,
          matchedTarget: col.labelKey,
          score: colMatch.score,
        },
        operator: {
          inputStart: parsed.operator!.token.start,
          inputEnd: parsed.operator!.token.end,
          inputText: parsed.operator!.token.text,
          matchedTarget: opInfo.id,
          score: opMatch.score,
        },
      };
      
      suggestions.push(
        createSuggestion(
          col,
          op,
          undefined,
          0, // Score will be calculated by createSuggestion using matchMetadata
          undefined,
          undefined,
          colOpMatchMeta,
          tokens,
          i18nProvider
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
      // Get locale for date parsing
      const locale = i18nProvider?.locale ?? "en";
      
      if (valueTokens.length > 0) {
        const valueQuery = valueTokens.map((t) => t.text).join(" ");
        const parsedDate = parseDate(valueQuery, { locale });

        if (parsedDate) {
          const colToken = parsed.column!.token;
          const opToken = parsed.operator!.token;
          const valueStart = valueTokens[0]?.start ?? 0;
          const valueEnd =
            valueTokens[valueTokens.length - 1]?.end ?? valueQuery.length;
          const isRangeDate =
            parsedDate.rangeStart && parsedDate.rangeEnd && isOperatorVariadic(opInfo);

          const dateMatchMeta: MatchMetadata = {
            column: {
              inputStart: colToken.start,
              inputEnd: colToken.end,
              inputText: colToken.text,
              matchedTarget: col.labelKey,
              score: parsed.column!.match.score,
            },
            operator: {
              inputStart: opToken.start,
              inputEnd: opToken.end,
              inputText: opToken.text,
              matchedTarget: opInfo.id,
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
              createDateSuggestion({
                column: col,
                operator: op,
                parsedDate,
                score: SCORING_CONFIG.BONUS.DATE_FILTER_COMPLETE,
                resultCount: countForDateFilter(
                  col.id,
                  op,
                  parsedDate,
                  this.getData(),
                  contextRowIndices
                ),
                matchMetadata: dateMatchMeta,
                queryTokens: tokens,
              })
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
              // Use the matched key for display (e.g., "Technik" when user types in German)
              const matchedKey = match.key;
              // Apply smart scoring for value match using the matched key
              const valScore = calculateSmartScore(
                match.score,
                match.indexes,
                matchedKey
              );
              const colMatch = parsed.column!.match;
              
              // Build match metadata for column + value match
              const colValMatchMeta: MatchMetadata = {
                column: {
                  inputStart: parsed.column!.token.start,
                  inputEnd: parsed.column!.token.end,
                  inputText: parsed.column!.token.text,
                  matchedTarget: col.labelKey,
                  score: colMatch.score,
                },
                values: [{
                  inputStart: valueTokens[0]!.start,
                  inputEnd: valueTokens[valueTokens.length - 1]!.end,
                  inputText: valueQueryNorm,
                  // Use matched key (translated value) for display
                  matchedTarget: matchedKey,
                  matchIndexes: match.indexes,
                  score: match.score,
                }],
              };
              
              suggestions.push(
                createSuggestion(
                  col,
                  op,
                  [createTypedValue(match.value.value, col.type)],
                  0, // Score will be calculated by createSuggestion using matchMetadata
                  rowCount,
                  undefined,
                  colValMatchMeta,
                  tokens,
                  i18nProvider
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
            matchedTarget: col.labelKey,
            score: parsed.column!.match.score,
          },
          operator: {
            inputStart: opToken.start,
            inputEnd: opToken.end,
            inputText: opToken.text,
            matchedTarget: opInfo.id,
            score: parsed.operator!.match.score,
          },
        };

        // Get locale-specific date suggestions
        const locale = i18nProvider?.locale ?? "en";
        const dateSuggestions = getDateSuggestionsForLocale(locale);
        
        for (const dateSuggestion of dateSuggestions) {
          const parsedDate = parseDate(dateSuggestion.text, { locale });
          if (parsedDate) {
            const key = `${col.id}:${op}:date:${dateSuggestion.text}`;
            if (!seenValues.has(key)) {
              seenValues.add(key);
              suggestions.push(
                createDateSuggestion({
                  column: col,
                  operator: op,
                  parsedDate,
                  score: parsed.column!.match.score,
                  resultCount: countForDateFilter(
                    col.id,
                    op,
                    parsedDate,
                    this.getData(),
                    contextRowIndices
                  ),
                  customLabel: dateSuggestion.label,
                  matchMetadata: colOpMatchMeta,
                  queryTokens: tokens,
                })
              );
            }
          }
        }
      }
    } else {
      // Non-date columns - handle variadic operators specially
      if (valueTokens.length > 0) {
        if (isOperatorVariadic(opInfo) && valueTokens.length >= 1) {
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
            // Normalize raw fuzzysort scores from parsed matches
            const colMatch = parsed.column!.match;
            const opMatch = parsed.operator?.match;
            const sCol = Math.max(0, Math.min(1, 1 + (colMatch.score / 10000)));
            const sOp = opMatch ? Math.max(0, Math.min(1, 1 + (opMatch.score / 10000))) : 0;
            
            // Calculate average value score using smart scoring
            // Find the corresponding match info to get indexes for smart scoring
            const avgValScore =
              matchedValues.reduce((sum, v) => {
                // Find the token match info for this value to get indexes
                const tokenMatch = tokenMatchInfo.find(
                  (info) => info && info.matchedValue === v.value
                );
                if (tokenMatch) {
                  // Use smart scoring with indexes
                  return sum + calculateSmartScore(
                    v.score,
                    tokenMatch.matchIndexes,
                    v.value
                  );
                } else {
                  // Fallback: normalize raw score
                  return sum + Math.max(0, Math.min(1, 1 + (v.score / 10000)));
                }
              }, 0) / matchedValues.length;

            const args: import("../../types/index.ts").HypothesisValueType[] =
              matchedValues.map((v) => createTypedValue(v.value, col.type));
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
                matchedTarget: col.labelKey,
                score: colMatch.score,
              },
              operator: {
                inputStart: opToken.start,
                inputEnd: opToken.end,
                inputText: opToken.text,
                matchedTarget: op,
                score: opMatch?.score ?? 0,
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
                  0, // Score will be calculated by createSuggestion using matchMetadata
                  undefined,
                  undefined,
                  matchMeta,
                  tokens,
                  i18nProvider
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
              // Use the matched key for display (e.g., "Technik" when user types in German)
              const matchedKey = match.key;
              // Normalize raw fuzzysort scores and apply smart scoring for value
              const colMatch = parsed.column!.match;
              const opMatch = parsed.operator?.match;
              const sCol = Math.max(0, Math.min(1, 1 + (colMatch.score / 10000)));
              const sOp = opMatch ? Math.max(0, Math.min(1, 1 + (opMatch.score / 10000))) : 0;
              const sVal = calculateSmartScore(
                match.score,
                match.indexes,
                matchedKey
              );
              
              const key = `${col.id}:${op}:${match.value.value}`;
              if (!seenValues.has(key)) {
                seenValues.add(key);
                const rowCount =
                  contextRowIndices !== null ? undefined : match.value.rowCount;
                // Build match metadata for value match
                const valueMatchMeta: MatchMetadata = {
                  column: {
                    inputStart: parsed.column!.token.start,
                    inputEnd: parsed.column!.token.end,
                    inputText: parsed.column!.token.text,
                    matchedTarget: col.labelKey,
                    score: colMatch.score,
                  },
                  operator: {
                    inputStart: parsed.operator!.token.start,
                    inputEnd: parsed.operator!.token.end,
                    inputText: parsed.operator!.token.text,
                    matchedTarget: op,
                    score: opMatch?.score ?? 0,
                  },
                  values: [{
                    inputStart: valueTokens[0]!.start,
                    inputEnd: valueTokens[valueTokens.length - 1]!.end,
                    inputText: valueQuery,
                    // Use matched key (translated value) for display
                    matchedTarget: matchedKey,
                    matchIndexes: match.indexes,
                    score: match.score,
                  }],
                };
                
                suggestions.push(
                  createSuggestion(
                    col,
                    op,
                    [createTypedValue(match.value.value, col.type)],
                    0, // Score will be calculated by createSuggestion using matchMetadata
                    rowCount,
                    undefined,
                    valueMatchMeta,
                    tokens,
                    i18nProvider
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
                [createTypedValue(entry.value.value, col.type)],
                parsed.column!.match.score,
                rowCount,
                undefined,
                undefined,
                tokens,
                i18nProvider
              )
            );
          }
        }
      }
    }

    return suggestions;
  }
}
