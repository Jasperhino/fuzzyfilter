/**
 * Strategy: Value Inference
 * 
 * Handles value-only inference when no column/operator matches are found.
 * This includes:
 * - Strategy 3: Pure value-only input detection
 * - Strategy 3.5: Column-matched multi-value aggregation
 * - Strategy 4: Operator-matched variadic value aggregation
 */

import type { SuggestionStrategy, StrategyContext } from "./interface.ts";
import type { FilterSuggestion, OperatorDefinition } from "../../types/index.ts";
import type {
  MatchMetadata,
  DetectedValues,
  PositionedValueMatch,
} from "../types.ts";
import { getColumns } from "../../schema-builder.ts";
import { getOperatorsForType, getOperator } from "../../operators.ts";
import { DataType } from "../../types/index.ts";
import { detectValueTokens, selectNonOverlappingMatches, toHypothesisValue } from "../engine/helpers.ts";
import { createSuggestion, createDateSuggestion, countForDateFilter } from "../engine/suggestion-helpers.ts";
import { SCORING_CONFIG } from "../constants.ts";
import { formatDateForDisplay } from "../../date-parser.ts";

/**
 * Check if an operator is variadic (accepts multiple arguments).
 * Derived from patterns - checks if any pattern has:
 * - A variadic placeholder ({...} or {name...})
 * - 2+ argument placeholders
 */
function isOperatorVariadic(op: OperatorDefinition | undefined): boolean {
  if (!op) return false;
  if (!op.patterns) return false;
  
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
 */
function getMinArguments(op: OperatorDefinition | undefined): number {
  if (!op) return 0;
  // Derive from patterns: minimum arg count across all patterns
  if (!op.patterns) return 0;
  const counts = op.patterns.map(p => (p.match(/\{[^}]+\}/g) || []).length);
  return Math.min(...counts, 0);
}

/**
 * Strategy for value-only inference
 */
export class ValueInferenceStrategy implements SuggestionStrategy {
  constructor(
    private getSchema: () => import("../../types/index.ts").Schema | null,
    private getColumnById: (
      id: import("../../types/index.ts").ColumnId | string
    ) => import("../../types/index.ts").AnyColumnDefinition | null
  ) {}

  canHandle(context: StrategyContext): boolean {
    const hasColumnMatches = context.columnScores.size > 0;
    const hasOperatorMatches = context.operatorScores.size > 0;
    
    // Strategy 3: No column/operator matches but we have tokens
    if (!hasColumnMatches && !hasOperatorMatches && context.tokens.length >= 1) {
      return true;
    }
    
    // Strategy 3.5: Column matched but no operator, and we have value matches
    if (hasColumnMatches && context.valueScores.size > 0 && !hasOperatorMatches) {
      return true;
    }
    
    // Strategy 4: Operator matched but no column, and we have value matches
    if (hasOperatorMatches && context.valueScores.size > 0) {
      return true;
    }
    
    return false;
  }

  generate(context: StrategyContext): FilterSuggestion[] {
    const schema = this.getSchema();
    if (!schema) return [];

    const suggestions: FilterSuggestion[] = [];
    const hasColumnMatches = context.columnScores.size > 0;
    const hasOperatorMatches = context.operatorScores.size > 0;

    // Strategy 3: Pure value-only input
    if (!hasColumnMatches && !hasOperatorMatches && context.tokens.length >= 1) {
      suggestions.push(...this.generatePureValueSuggestions(context));
    }

    // Strategy 3.5: Column-matched multi-value aggregation
    if (hasColumnMatches && context.valueScores.size > 0 && !hasOperatorMatches) {
      suggestions.push(...this.generateColumnMatchedMultiValueSuggestions(context));
    }

    // Strategy 4: Operator-matched variadic value aggregation
    if (hasOperatorMatches && context.valueScores.size > 0) {
      suggestions.push(...this.generateOperatorMatchedMultiValueSuggestions(context));
    }

    return suggestions;
  }

  /**
   * Strategy 3: Generate suggestions for pure value-only input
   */
  private generatePureValueSuggestions(context: StrategyContext): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const { tokens, valueScores, contextAvailableValues, contextRowIndices } = context;

    // Detect all potential argument values from tokens
    const locale = context.i18nProvider?.getLocale?.();
    const allDetectedValues = detectValueTokens(tokens, new Set(), locale);

    // Collect ALL value matches per column with their ngram positions
    const allMatchesByColumn = new Map<
      import("../../types/index.ts").ColumnId,
      PositionedValueMatch[]
    >();
    for (const [_key, { match, breakdown, ngram, matchIndexes, matchedTarget }] of valueScores) {
      if (!allMatchesByColumn.has(match.value.columnId)) {
        allMatchesByColumn.set(match.value.columnId, []);
      }
      allMatchesByColumn.get(match.value.columnId)!.push({
        value: match.value.value, // Original value for filtering
        displayValue: matchedTarget, // Translated value for display
        score: breakdown.adjustedScore,
        ngram,
        matchIndexes,
      });
    }

    // For each column, select non-overlapping matches
    const stringValueMatches: Map<
      import("../../types/index.ts").ColumnId,
      PositionedValueMatch[]
    > = new Map();
    for (const [columnId, matches] of allMatchesByColumn) {
      const nonOverlapping = selectNonOverlappingMatches(matches);
      // Deduplicate by value
      const seen = new Set<string>();
      const dedupedMatches: PositionedValueMatch[] = [];
      for (const m of nonOverlapping) {
        if (!seen.has(m.value)) {
          seen.add(m.value);
          dedupedMatches.push(m);
        }
      }
      if (dedupedMatches.length > 0) {
        stringValueMatches.set(columnId, dedupedMatches);
      }
    }

    // Generate suggestions for numeric columns
    if (allDetectedValues.numbers.length >= 1) {
      suggestions.push(
        ...this.generateNumericValueSuggestions(
          allDetectedValues.numbers.map((n) => n.value),
          contextAvailableValues,
          contextRowIndices,
          tokens,
          context.i18nProvider
        )
      );
    }

    // Generate suggestions for date columns
    if (allDetectedValues.dates.length >= 1) {
      suggestions.push(
        ...this.generateDateValueSuggestions(
          allDetectedValues.dates,
          contextAvailableValues,
          contextRowIndices,
          tokens,
          context.i18nProvider
        )
      );
    }

    // Generate suggestions for string/enum columns
    for (const [columnId, valueMatches] of stringValueMatches) {
      const col = this.getColumnById(columnId);
      if (!col || (col.type !== DataType.STRING && col.type !== DataType.ENUM)) continue;

      if (valueMatches.length >= 2) {
        suggestions.push(
          ...this.generateMultiStringValueSuggestions(
            col,
            valueMatches,
            tokens,
            contextRowIndices
          )
        );
      }
    }

    return suggestions;
  }

  /**
   * Generate suggestions for numeric values
   */
  private generateNumericValueSuggestions(
    numValues: number[],
    contextAvailableValues: import("../types.ts").ContextAvailableValues | null,
    contextRowIndices: Set<number> | null,
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const schema = this.getSchema();
    if (!schema) return [];

    for (const col of getColumns(schema)) {
      if (col.type !== DataType.NUMBER) continue;

      // Filter to only numeric values that exist in the context
      const filteredValues = numValues.filter((val) => {
        if (!contextAvailableValues) return true;
        return contextAvailableValues.get(col.id)?.numbers.has(val) ?? false;
      });

      if (filteredValues.length === 0) continue;

      const ops = getOperatorsForType(col.type);
      const baseScore = SCORING_CONFIG.BONUS.VALUE_ONLY_BASE;

      if (filteredValues.length >= 2) {
        // Multiple values: prioritize between, in operators
        for (const op of ops) {
          const opInfo = getOperator(op.id);
          let valuesUsed = 0;
          let suggestionArgs: import("../../types/index.ts").HypothesisValueType[] | undefined;

          if (isOperatorVariadic(opInfo)) {
            const minArgs = getMinArguments(opInfo) || 1;

            if (minArgs === 2) {
              valuesUsed = 2;
              const sorted = [...filteredValues].slice(0, 2).sort((a, b) => a - b);
              suggestionArgs = sorted.map((v) => toHypothesisValue(v));
            } else {
              valuesUsed = filteredValues.length;
              suggestionArgs = filteredValues.map((v) => toHypothesisValue(v));
            }
          } else if (operatorRequiresArgument(opInfo)) {
            valuesUsed = 1;
            suggestionArgs = [toHypothesisValue(filteredValues[0]!)];
          }

          if (valuesUsed > 0) {
            // Coverage multiplier based on how many values were used
            const coverageMultiplier = valuesUsed / filteredValues.length;
            const adjustedScore = baseScore * (0.7 + 0.3 * coverageMultiplier);

            suggestions.push(
              createSuggestion(
                col,
                op.id,
                suggestionArgs,
                adjustedScore,
                undefined,
                undefined,
                undefined,
                tokens,
                i18nProvider
              )
            );
          }
        }
      } else {
        // Single numeric value
        const numVal = filteredValues[0]!;
        for (const op of ops.slice(0, 5)) {
          const opInfo = getOperator(op.id);
          if (!operatorRequiresArgument(opInfo) || isOperatorVariadic(opInfo)) continue;

          suggestions.push(
            createSuggestion(
              col,
              op.id,
              [toHypothesisValue(numVal)],
              baseScore * 1.0, // Full coverage (use full base score)
              undefined,
              undefined,
              undefined,
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
   * Generate suggestions for date values
   */
  private generateDateValueSuggestions(
    dateValues: Array<{ value: Date; token: import("../../types/index.ts").Token; index: number; parsed?: import("../../types/index.ts").ParsedDate }>,
    contextAvailableValues: import("../types.ts").ContextAvailableValues | null,
    contextRowIndices: Set<number> | null,
    tokens: import("../../types/index.ts").Token[],
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const schema = this.getSchema();
    if (!schema) return [];

    for (const col of getColumns(schema)) {
      if (col.type !== DataType.DATE) continue;

      // Filter to only date values that exist in the context
      const filteredValues = dateValues.filter((entry) => {
        if (!contextAvailableValues) return true;
        return contextAvailableValues.get(col.id)?.dates.has(entry.value.getTime()) ?? false;
      });

      if (filteredValues.length === 0) continue;

      const ops = getOperatorsForType(col.type);
      const baseScore = SCORING_CONFIG.BONUS.VALUE_ONLY_BASE;

      // Separate date ranges from single dates
      const dateRanges: typeof filteredValues = [];
      const nonRangeDates: typeof filteredValues = [];
      
      for (const dateEntry of filteredValues) {
        if (dateEntry.parsed?.isRange && dateEntry.parsed.rangeStart && dateEntry.parsed.rangeEnd) {
          dateRanges.push(dateEntry);
        } else {
          nonRangeDates.push(dateEntry);
        }
      }

      // Handle date ranges - suggest "between" operator
      for (const dateEntry of dateRanges) {
        const betweenOp = ops.find(op => op.id === "between");
        if (betweenOp && dateEntry.parsed) {
          const matchMeta: MatchMetadata = {
            values: [{
              inputStart: dateEntry.token.start,
              inputEnd: dateEntry.token.end,
              inputText: dateEntry.token.text,
              matchedTarget: formatDateForDisplay(dateEntry.parsed.rangeStart!),
              score: 0,
            }, {
              inputStart: dateEntry.token.start,
              inputEnd: dateEntry.token.end,
              inputText: dateEntry.token.text,
              matchedTarget: formatDateForDisplay(dateEntry.parsed.rangeEnd!),
              score: 0,
            }],
          };

          suggestions.push(
            createDateSuggestion({
              column: col,
              operator: betweenOp.id,
              parsedDate: dateEntry.parsed!,
              score: baseScore * 1.0, // Full coverage
              matchMetadata: matchMeta,
              queryTokens: tokens,
              i18nProvider,
            })
          );
        }
      }

      if (nonRangeDates.length >= 2) {
        // Multiple dates: prioritize between
        for (const op of ops) {
          const opInfo = getOperator(op.id);
          let valuesUsed = 0;
          let suggestionArgs: import("../../types/index.ts").HypothesisValueType[] | undefined;
          let valueMatchEntries: Array<{
            inputStart: number;
            inputEnd: number;
            inputText: string;
            matchedTarget: string;
            score: number;
          }> = [];

          if (isOperatorVariadic(opInfo)) {
            const minArgs = getMinArguments(opInfo) || 1;

            if (minArgs === 2) {
              valuesUsed = 2;
              const sorted = [...nonRangeDates]
                .slice(0, 2)
                .sort((a, b) => a.value.getTime() - b.value.getTime());
              suggestionArgs = sorted.map((v) => toHypothesisValue(v.value, v.parsed));
              valueMatchEntries = sorted.map((v) => ({
                inputStart: v.token.start,
                inputEnd: v.token.end,
                inputText: v.token.text,
                matchedTarget: formatDateForDisplay(v.value),
                score: 0,
              }));
            } else {
              valuesUsed = nonRangeDates.length;
              suggestionArgs = nonRangeDates.map((v) => toHypothesisValue(v.value, v.parsed));
              valueMatchEntries = nonRangeDates.map((v) => ({
                inputStart: v.token.start,
                inputEnd: v.token.end,
                inputText: v.token.text,
                matchedTarget: formatDateForDisplay(v.value),
                score: 0,
              }));
            }
          } else if (operatorRequiresArgument(opInfo)) {
            valuesUsed = 1;
            const firstVal = nonRangeDates[0]!;
            suggestionArgs = [toHypothesisValue(firstVal.value, firstVal.parsed)];
            valueMatchEntries = [{
              inputStart: firstVal.token.start,
              inputEnd: firstVal.token.end,
              inputText: firstVal.token.text,
              matchedTarget: formatDateForDisplay(firstVal.value),
              score: 0,
            }];
          }

          if (valuesUsed > 0) {
            // Coverage multiplier based on how many values were used
            const coverageMultiplier = valuesUsed / nonRangeDates.length;
            const adjustedScore = baseScore * (0.7 + 0.3 * coverageMultiplier);

            const matchMeta: import("../types.ts").MatchMetadata = {
              values: valueMatchEntries,
            };

            suggestions.push(
              createSuggestion(
                col,
                op.id,
                suggestionArgs,
                adjustedScore,
                undefined,
                undefined,
                matchMeta,
                tokens,
                i18nProvider
              )
            );
          }
        }
      } else if (nonRangeDates.length === 1) {
        // Single date value (non-range)
        const dateEntry = nonRangeDates[0]!;
        const dateVal = dateEntry.value;
        for (const op of ops.slice(0, 5)) {
          const opInfo = getOperator(op.id);
          if (!operatorRequiresArgument(opInfo) || isOperatorVariadic(opInfo)) continue;

          const matchMeta: MatchMetadata = {
            values: [{
              inputStart: dateEntry.token.start,
              inputEnd: dateEntry.token.end,
              inputText: dateEntry.token.text,
              matchedTarget: formatDateForDisplay(dateVal),
              score: 0,
            }],
          };

          suggestions.push(
            createSuggestion(
              col,
              op.id,
              [toHypothesisValue(dateVal, dateEntry.parsed)],
              baseScore * 1.0, // Full coverage
              undefined,
              undefined,
              matchMeta,
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
   * Generate suggestions for multiple string values
   */
  private generateMultiStringValueSuggestions(
    col: import("../../types/index.ts").AnyColumnDefinition,
    valueMatches: PositionedValueMatch[],
    tokens: import("../../types/index.ts").Token[],
    contextRowIndices: Set<number> | null,
    i18nProvider?: import("../../types/i18n.ts").I18nProvider
  ): FilterSuggestion[] {
    const suggestions: FilterSuggestion[] = [];
    const ops = getOperatorsForType(col.type, i18nProvider);
    const variadicOps = ops.filter((op) => {
      const opInfo = getOperator(op.id, i18nProvider);
      return isOperatorVariadic(opInfo) && (getMinArguments(opInfo) || 1) === 1;
    });

    // Build match metadata for highlighting
    const matchMeta: MatchMetadata = {
      values: valueMatches.map((v) => ({
        inputStart: v.ngram.inputStart,
        inputEnd: v.ngram.inputEnd,
        inputText: v.ngram.text,
        matchedTarget: v.displayValue, // Use translated value for display
        matchIndexes: v.matchIndexes,
        score: v.score,
      })),
    };

    for (const op of variadicOps) {
      suggestions.push(
        createSuggestion(
          col,
          op.id,
          valueMatches.map((v) => toHypothesisValue(v.value)),
          0, // Score will be calculated by createSuggestion using matchMetadata
          undefined,
          undefined,
          matchMeta,
          tokens,
          i18nProvider
        )
      );
    }

    return suggestions;
  }

  /**
   * Strategy 3.5: Generate suggestions when column is matched but no operator
   */
  private generateColumnMatchedMultiValueSuggestions(
    context: StrategyContext
  ): FilterSuggestion[] {
    const i18nProvider = context.i18nProvider;
    const suggestions: FilterSuggestion[] = [];
    const {
      columnScores,
      valueScores,
      tokens,
      contextRowIndices,
    } = context;

    // Collect ALL value matches per column with their ngram positions
    const allValueMatchesByColumn = new Map<
      import("../../types/index.ts").ColumnId,
      PositionedValueMatch[]
    >();
    for (const [_key, { match, breakdown, ngram: valNgram, matchIndexes, matchedTarget }] of valueScores) {
      if (!allValueMatchesByColumn.has(match.value.columnId)) {
        allValueMatchesByColumn.set(match.value.columnId, []);
      }
      allValueMatchesByColumn.get(match.value.columnId)!.push({
        value: match.value.value, // Original value for filtering
        displayValue: matchedTarget, // Translated value for display
        score: breakdown.adjustedScore,
        ngram: valNgram,
        matchIndexes,
      });
    }

    // For each column that has a column match, aggregate values
    for (const [colId, colEntry] of columnScores) {
      const col = this.getColumnById(colId as import("../../types/index.ts").ColumnId);
      if (!col || (col.type !== DataType.STRING && col.type !== DataType.ENUM)) continue;

      const matchesForCol = allValueMatchesByColumn.get(col.id);
      if (!matchesForCol || matchesForCol.length === 0) continue;

      // Exclude the column's input positions from value matching
      const excludedPositions = [
        { start: colEntry.ngram.inputStart, end: colEntry.ngram.inputEnd },
      ];

      // Select non-overlapping value matches (excluding column positions)
      const nonOverlapping = selectNonOverlappingMatches(matchesForCol, excludedPositions);

      // Deduplicate by value
      const seenValueStrings = new Set<string>();
      const aggregatedValues: PositionedValueMatch[] = [];
      for (const m of nonOverlapping) {
        if (!seenValueStrings.has(m.value)) {
          seenValueStrings.add(m.value);
          aggregatedValues.push(m);
        }
      }

      // Only generate multi-value suggestions if we have 2+ values
      if (aggregatedValues.length >= 2) {
        const ops = getOperatorsForType(col.type);
        const variadicOps = ops.filter((op) => {
          const opInfo = getOperator(op.id);
          if (!opInfo) return false;
          // Check if variadic - either from isVariadic flag or patterns with 2+ args
          const isVariadic = isOperatorVariadic(opInfo);
          const minArgs = getMinArguments(opInfo) || 1;
          return isVariadic && minArgs === 1;
        });

        for (const op of variadicOps) {
          const args: import("../../types/index.ts").HypothesisValueType[] =
            aggregatedValues.map((v) => toHypothesisValue(v.value));

          // Calculate weighted score: column + average value scores
          // Build match metadata
          const matchMeta: MatchMetadata = {
            column: {
              inputStart: colEntry.ngram.inputStart,
              inputEnd: colEntry.ngram.inputEnd,
              inputText: colEntry.ngram.text,
              matchedTarget: colEntry.matchedTarget,
              matchIndexes: colEntry.matchIndexes,
              score: colEntry.breakdown.rawScore,
            },
            values: aggregatedValues.map((v) => ({
              inputStart: v.ngram.inputStart,
              inputEnd: v.ngram.inputEnd,
              inputText: v.ngram.text,
              matchedTarget: v.displayValue, // Use translated value for display
              matchIndexes: v.matchIndexes,
              score: v.score,
            })),
          };

          suggestions.push(
            createSuggestion(
              col,
              op.id,
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
    }

    return suggestions;
  }

  /**
   * Strategy 4: Generate suggestions when operator is matched but no column
   */
  private generateOperatorMatchedMultiValueSuggestions(
    context: StrategyContext
  ): FilterSuggestion[] {
    const i18nProvider = context.i18nProvider;
    const suggestions: FilterSuggestion[] = [];
    const {
      operatorScores,
      valueScores,
      tokens,
      contextRowIndices,
    } = context;

    // Collect ALL value matches per column with their ngram positions
    const allValueMatchesByColumnForOp = new Map<
      import("../../types/index.ts").ColumnId,
      PositionedValueMatch[]
    >();
    for (const [_key, { match, breakdown, ngram: valNgram, matchIndexes, matchedTarget }] of valueScores) {
      if (!allValueMatchesByColumnForOp.has(match.value.columnId)) {
        allValueMatchesByColumnForOp.set(match.value.columnId, []);
      }
      allValueMatchesByColumnForOp.get(match.value.columnId)!.push({
        value: match.value.value, // Original value for filtering
        displayValue: matchedTarget, // Translated value for display
        score: breakdown.adjustedScore,
        ngram: valNgram,
        matchIndexes,
      });
    }

    // For each operator match, find compatible columns and aggregate values
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
      const schema = this.getSchema();
      if (!schema || !opInfo) continue;

      // Check if variadic - either from isVariadic flag or patterns with 2+ args
      const isVariadic = isOperatorVariadic(opInfo);
      const minArgs = getMinArguments(opInfo) || 1;

      for (const col of getColumns(schema)) {
        // Skip if this is a type-specific alias that doesn't match the column type
        if (forType && forType !== col.type) continue;

        if (!opInfo.supportedTypes.includes(col.type)) continue;
        if (!isVariadic || minArgs !== 1) continue;

        const matchesForCol = allValueMatchesByColumnForOp.get(col.id);
        if (!matchesForCol || matchesForCol.length < 2) continue;

        // Exclude operator positions from value matching
        const excludedPositions = [
          { start: opNgram.inputStart, end: opNgram.inputEnd },
        ];

        // Select non-overlapping value matches
        const nonOverlapping = selectNonOverlappingMatches(matchesForCol, excludedPositions);

        // Deduplicate by value
        const seenValueStrings = new Set<string>();
        const aggregatedValues: PositionedValueMatch[] = [];
        for (const m of nonOverlapping) {
          if (!seenValueStrings.has(m.value)) {
            seenValueStrings.add(m.value);
            aggregatedValues.push(m);
          }
        }

        if (aggregatedValues.length >= 2) {
          const args: import("../../types/index.ts").HypothesisValueType[] =
            aggregatedValues.map((v) => toHypothesisValue(v.value));

          const matchMeta: MatchMetadata = {
            operator: {
              inputStart: opNgram.inputStart,
              inputEnd: opNgram.inputEnd,
              inputText: opNgram.text,
              matchedTarget: opMatchedTarget,
              matchIndexes: opMatchIndexes,
              score: opBreakdown.rawScore,
            },
            values: aggregatedValues.map((v) => ({
              inputStart: v.ngram.inputStart,
              inputEnd: v.ngram.inputEnd,
              inputText: v.ngram.text,
              matchedTarget: v.displayValue, // Use translated value for display
              matchIndexes: v.matchIndexes,
              score: v.score,
            })),
          };

          suggestions.push(
            createSuggestion(
              col,
              operator,
              args,
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
    }

    return suggestions;
  }
}
