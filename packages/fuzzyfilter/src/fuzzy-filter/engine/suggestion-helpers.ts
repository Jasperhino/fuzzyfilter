/**
 * Helper functions for creating filter suggestions
 * 
 * These functions handle the construction of FilterSuggestion objects,
 * including formatting, scoring, and metadata generation.
 */

import type {
  FilterSuggestion,
  AnyColumnDefinition,
  Operator,
  HypothesisValueType,
  Token,
  QueryMatch,
  ParsedDate,
  ColumnId,
} from "../../types/index.ts";
import type { ScoreBreakdown, MatchMetadata } from "../types.ts";
import type { I18nProvider } from "../../types/i18n.ts";
import { getOperator, type OperatorKey } from "../../operators.ts";
import type { OperatorDefinition } from "../../types/core.ts";
import { formatDateForDisplay } from "../../date-parser.ts";
import { calculateQueryExplanationScore } from "./scorer.ts";

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
 * Get the translated column name using i18n.
 * 
 * In V2, columns always have a labelKey which is resolved via i18n provider.
 * Falls back to extracting the last part of the labelKey if translation fails.
 * 
 * @param column - The column definition
 * @param i18nProvider - i18n provider for translations (required in V2)
 * @returns The translated column name
 */
export function getTranslatedColumnName(
  column: AnyColumnDefinition,
  i18nProvider?: I18nProvider
): string {
  if (!i18nProvider) {
    // Fallback: extract last part of labelKey
    const parts = column.labelKey.split(".");
    return parts[parts.length - 1] ?? column.labelKey;
  }
  
  // Use getLabel to get the primary display label
  return i18nProvider.getLabel(column.labelKey);
}

/**
 * Get the translated enum value label using i18n.
 * 
 * In V2, enum values use the pattern {valuesI18nPrefix ?? column.id}.{value}
 * to generate i18n keys.
 * 
 * @param column - The column definition with values
 * @param value - The enum value to get label for
 * @param i18nProvider - i18n provider for translations (required in V2)
 * @returns The translated label, or the value itself if no translation found
 */
export function getTranslatedEnumValueLabel(
  column: AnyColumnDefinition,
  value: unknown,
  i18nProvider?: I18nProvider
): string {
  if (!column.values || !i18nProvider) {
    return String(value);
  }

  const prefix = column.valuesI18nPrefix ?? (typeof column.id === 'string' ? column.id : String(column.id));
  const valueKey = `${prefix}.${value}`;
  
  // Use getLabel to get the primary display label
  return i18nProvider.getLabel(valueKey);
}

/**
 * Get the translated boolean label using i18n, falling back to static label.
 * 
 * @param column - The boolean column definition
 * @param value - true or false
 * @param i18nProvider - Optional i18n provider for translations
 * @returns The translated label, or the static label if no translation found
 */
export function getTranslatedBooleanLabel(
  column: BooleanColumnDefinition,
  value: boolean,
  i18nProvider?: I18nProvider
): string {
  if (value) {
    // Try to translate true label
    if (column.trueLabelKey && i18nProvider?.translate) {
      const translated = i18nProvider.translate(column.trueLabelKey);
      if (translated) {
        return translated;
      }
    }
    return column.trueLabel ?? "true";
  } else {
    // Try to translate false label
    if (column.falseLabelKey && i18nProvider?.translate) {
      const translated = i18nProvider.translate(column.falseLabelKey);
      if (translated) {
        return translated;
      }
    }
    return column.falseLabel ?? "false";
  }
}

/**
 * Result of truncating a value with ellipsis
 */
export interface TruncateResult {
  /** Truncated display text with ellipsis */
  displayText: string;
  /** Adjusted character indexes relative to displayText (accounting for excerpt offset and ellipsis) */
  adjustedIndexes?: number[];
}

/**
 * Truncate a value string with ellipsis, centering around matched characters if provided.
 * Uses a fixed 5-character padding around the match (or as much as available).
 * 
 * @param value - The full value string
 * @param matchedIndexes - Optional array of character indexes that were matched (relative to full value)
 * @param maxDisplayLength - Maximum length for the display text (default: 30)
 * @returns TruncateResult with displayText and adjustedIndexes, or undefined if no truncation needed
 */
export function truncateWithEllipsis(
  value: string,
  matchedIndexes?: readonly number[],
  maxDisplayLength = 30
): TruncateResult | undefined {
  // If value is short enough, no truncation needed
  if (value.length <= maxDisplayLength) {
    return undefined;
  }

  // If no match indexes, truncate from the start
  if (!matchedIndexes || matchedIndexes.length === 0) {
    return {
      displayText: value.slice(0, maxDisplayLength - 1) + "…",
      adjustedIndexes: undefined,
    };
  }

  // Find the range of matched characters
  const firstMatchIdx = Math.min(...matchedIndexes);
  const lastMatchIdx = Math.max(...matchedIndexes);
  const matchLength = lastMatchIdx - firstMatchIdx + 1;

  // Use fixed 5-character padding around the match (or as much as available)
  const paddingSize = 5;
  const minRequiredLength = matchLength + paddingSize * 2;
  
  // Calculate visible range with fixed padding
  let start = Math.max(0, firstMatchIdx - paddingSize);
  let end = Math.min(value.length, lastMatchIdx + paddingSize + 1);
  
  // If we don't have enough space, prioritize showing the match
  const currentLength = end - start;
  if (currentLength > maxDisplayLength - 2) { // Reserve space for ellipses
    // Try to fit within maxDisplayLength while keeping match visible
    const availableForContent = maxDisplayLength - 2; // Reserve for ellipses
    if (matchLength >= availableForContent) {
      // Match is too long, just show the match
      start = firstMatchIdx;
      end = lastMatchIdx + 1;
    } else {
      // Distribute remaining space around the match
      const remainingSpace = availableForContent - matchLength;
      const paddingBefore = Math.min(paddingSize, Math.floor(remainingSpace / 2));
      const paddingAfter = Math.min(paddingSize, remainingSpace - paddingBefore);
      start = Math.max(0, firstMatchIdx - paddingBefore);
      end = Math.min(value.length, lastMatchIdx + paddingAfter + 1);
    }
  }

  // Build truncated string with ellipsis
  const showStartEllipsis = start > 0;
  const showEndEllipsis = end < value.length;

  let result = value.slice(start, end);
  let ellipsisOffset = 0;
  if (showStartEllipsis) {
    result = "…" + result;
    ellipsisOffset = 1; // Account for leading ellipsis
  }
  if (showEndEllipsis) {
    result = result + "…";
  }

  // Adjust matched indexes to be relative to the truncated displayText
  const adjustedIndexes: number[] = [];
  for (const idx of matchedIndexes) {
    if (idx >= start && idx < end) {
      // Map original index to position in displayText
      const adjustedIdx = idx - start + ellipsisOffset;
      adjustedIndexes.push(adjustedIdx);
    }
  }

  return {
    displayText: result,
    adjustedIndexes: adjustedIndexes.length > 0 ? adjustedIndexes : undefined,
  };
}

/**
 * Check if two dates are the same calendar day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Create a filter suggestion from components
 *
 * @param column - The column definition
 * @param operator - The operator
 * @param args - Optional arguments for the operator
 * @param scoreOrBreakdown - Score (number) or score breakdown object
 * @param resultCount - Optional pre-computed result count
 * @param matchedAlias - Optional matched alias for the operator
 * @param matchMetadata - Optional metadata for highlighting
 * @param queryTokens - Optional query tokens for coverage calculation
 * @returns A FilterSuggestion object
 */
export function createSuggestion(
  column: AnyColumnDefinition,
  operatorKey: OperatorKey,
  args: HypothesisValueType[] | undefined,
  scoreOrBreakdown: number | ScoreBreakdown,
  resultCount?: number,
  matchedAlias?: string,
  matchMetadata?: MatchMetadata,
  queryTokens?: Token[],
  i18nProvider?: I18nProvider
): FilterSuggestion {
  const opInfo = getOperator(operatorKey);

  // Format value text based on arguments
  let valueText = "";
  const argumentParts: { text: string; displayText?: string; displayMatchedIndexes?: number[]; highlight?: boolean; originalText?: string }[] = [];

  if (args && args.length > 0) {
    // Format values for display, translating enum values if needed
    const formattedValues = args
      .map((arg, index) => {
        if (arg.kind === "string") {
          // Check if this is an enum value that should be translated
          if (column.values && column.values.length > 0) {
            // Check if the value is in the column's values array
            if (column.values.includes(arg.value)) {
              // Use translated label for display
              return getTranslatedEnumValueLabel(column, arg.value, i18nProvider);
            }
          }
          return arg.value;
        }
        if (arg.kind === "number") return String(arg.value);
        if (arg.kind === "date") return formatDateForDisplay(arg.value);
        if (arg.kind === "boolean") {
          // Check if this is a boolean column that should be translated
          if (column.type === "boolean" && "trueLabelKey" in column) {
            const boolCol = column as BooleanColumnDefinition;
            return getTranslatedBooleanLabel(boolCol, arg.value, i18nProvider);
          }
          return String(arg.value);
        }
        return "";
      })
      .filter((v) => v !== "");

    // For between, format as "X - Y", for in/nin format as "X, Y, Z"
    if (operator === "between" && formattedValues.length >= 2) {
      valueText = `${formattedValues[0]} - ${formattedValues[1]}`;
    } else {
      valueText = formattedValues.join(", ");
    }

    // Create argument parts with truncation for long values
    // Match each formatted value to its corresponding match metadata
    for (let i = 0; i < formattedValues.length; i++) {
      const val = formattedValues[i]!; // Translated value for display
      const originalArg = args[i];
      const originalValue = originalArg?.kind === "string" ? originalArg.value : val;
      
      // Find the matching value in matchMetadata
      // matchMetadata.matchedTarget can be either the original value or the translated value
      // depending on what the user typed
      const valueMatch = matchMetadata?.values?.find((v) => 
        v.matchedTarget === originalValue || v.matchedTarget === val
      );
      
      // Use match indexes from metadata if available
      // If the match was against the translated value, the indexes are already correct for the translated text
      const truncateResult = truncateWithEllipsis(val, valueMatch?.matchIndexes);
      
      // For date arguments, include the original parsed text (e.g., "gestern")
      // This helps users understand what input led to this date suggestion
      let originalText: string | undefined;
      if (originalArg?.kind === "date" && originalArg.parsed?.text) {
        // Only include if it differs from the formatted date (e.g., "gestern" vs "Jan 4, 2026")
        // No need to show "Jan 4, 2026 (Jan 4, 2026)"
        if (originalArg.parsed.text.toLowerCase() !== val.toLowerCase()) {
          originalText = originalArg.parsed.text;
        }
      }
      
      argumentParts.push({ 
        text: val, // Use translated value for display
        displayText: truncateResult?.displayText,
        displayMatchedIndexes: truncateResult?.adjustedIndexes,
        originalText,
      });
    }
  }

  // Use matched alias in label if provided, otherwise use operator label
  const operatorDisplay = matchedAlias ?? opInfo.id;
  
  // Get translated column name for display
  const columnDisplayName = getTranslatedColumnName(column, i18nProvider);
  
  const label = valueText
    ? `${columnDisplayName} ${operatorDisplay} ${valueText}`
    : `${columnDisplayName} ${operatorDisplay}`;

  const columnDisplayName = getTranslatedColumnName(column, i18nProvider);
  const completionText = valueText
    ? `${columnDisplayName} ${operator} "${valueText}"`
    : `${columnDisplayName} ${operator} `;

  // Calculate query explanation score using the new centralized scorer
  // This replaces the old scattered scoring logic with a unified "how well does this explain the query?" approach
  let score: number;
  let scoreExplanation: import("./scorer.ts").ScoreExplanation | undefined;
  
  if (queryTokens && queryTokens.length > 0 && matchMetadata) {
    // Use the new query explanation scoring system
    const result = calculateQueryExplanationScore(matchMetadata, queryTokens, args);
    score = result.score;
    scoreExplanation = result.explanation;
  } else {
    // Fallback: if no matchMetadata or tokens, use the passed score
    const isBreakdownFallback = typeof scoreOrBreakdown === "object";
    score = isBreakdownFallback ? scoreOrBreakdown.adjustedScore : scoreOrBreakdown;
  }
  
  // Handle score breakdown for backward compatibility (if needed)
  const isBreakdown = typeof scoreOrBreakdown === "object";

  const scoreBreakdown = isBreakdown
    ? {
        rawScore: scoreOrBreakdown.rawScore,
        coverageBonus: scoreOrBreakdown.coverageBonus,
        completenessBonus: scoreOrBreakdown.completenessBonus,
        fullQueryBonus: scoreOrBreakdown.fullQueryBonus,
        exactMatchBonus: scoreOrBreakdown.exactMatchBonus,
        tokenCount: scoreOrBreakdown.tokenCount,
        totalTokens: scoreOrBreakdown.totalTokens,
        adjustedScore: scoreOrBreakdown.adjustedScore,
      }
    : undefined;

  // Build queryMatches array from match metadata
  const queryMatches: QueryMatch[] = [];
  if (matchMetadata) {
    if (matchMetadata.column) {
      queryMatches.push({
        inputRange: {
          start: matchMetadata.column.inputStart,
          end: matchMetadata.column.inputEnd,
        },
        inputText: matchMetadata.column.inputText,
        matchType: "column",
        matchedTarget: matchMetadata.column.matchedTarget,
        matchedCharIndexes: matchMetadata.column.matchIndexes
          ? [...matchMetadata.column.matchIndexes]
          : undefined,
        score: matchMetadata.column.score,
      });
    }
    if (matchMetadata.operator) {
      queryMatches.push({
        inputRange: {
          start: matchMetadata.operator.inputStart,
          end: matchMetadata.operator.inputEnd,
        },
        inputText: matchMetadata.operator.inputText,
        matchType: "operator",
        matchedTarget: matchMetadata.operator.matchedTarget,
        matchedCharIndexes: matchMetadata.operator.matchIndexes
          ? [...matchMetadata.operator.matchIndexes]
          : undefined,
        score: matchMetadata.operator.score,
      });
    }
    if (matchMetadata.values) {
      for (const val of matchMetadata.values) {
        queryMatches.push({
          inputRange: { start: val.inputStart, end: val.inputEnd },
          inputText: val.inputText,
          matchType: "value",
          matchedTarget: val.matchedTarget,
          matchedCharIndexes: val.matchIndexes ? [...val.matchIndexes] : undefined,
          score: val.score,
        });
      }
    }
  }

  return {
    id: `${column.id}:${operator}:${valueText}`,
    label,
    parts: {
      column: { text: columnDisplayName },
      operator: {
        text: opInfo.id,
        matchedAlias: matchedAlias,
      },
      arguments: argumentParts.length > 0 ? argumentParts : undefined,
    },
    column,
    operator,
    arguments: args,
    // Defer count computation to post-processing (lazy evaluation)
    // Use -1 as placeholder; counts are computed only for final suggestions
    resultCount: resultCount ?? -1,
    score,
    scoreBreakdown,
    isComplete:
      !operatorRequiresArgument(opInfo) ||
      (args !== undefined &&
        args.length > 0 &&
        // Variadic operators may require a minimum number of arguments
        (!isOperatorVariadic(opInfo) || args.length >= (getMinArguments(opInfo) || 1))),
    completionText,
    cursorPositionAfter: completionText.length,
    category:
      score === 0
        ? "exact"
        : scoreBreakdown?.rawScore === 0
          ? "exact"
          : "fuzzy",
    queryMatches: queryMatches.length > 0 ? queryMatches : undefined,
    scoreExplanation,
  };
}

/**
 * Options for creating a date suggestion
 */
export interface CreateDateSuggestionOptions {
  /** The column definition */
  column: AnyColumnDefinition;
  /** The operator */
  operator: Operator;
  /** The parsed date information */
  parsedDate: ParsedDate;
  /** The suggestion score (fallback if no matchMetadata/tokens) */
  score: number;
  /** Optional pre-computed result count */
  resultCount?: number;
  /** Optional custom label for the date */
  customLabel?: string;
  /** Optional metadata for highlighting */
  matchMetadata?: MatchMetadata;
  /** Optional query tokens for score calculation */
  queryTokens?: Token[];
  /** Optional i18n provider */
  i18nProvider?: I18nProvider;
}

/**
 * Create a suggestion for a date value
 *
 * @param options - Options for creating the date suggestion
 * @returns A FilterSuggestion object
 */
export function createDateSuggestion(options: CreateDateSuggestionOptions): FilterSuggestion {
  const {
    column,
    operator,
    parsedDate,
    score,
    resultCount,
    customLabel,
    matchMetadata,
    queryTokens,
    i18nProvider,
  } = options;

  const opInfo = getOperator(operator);
  if (!opInfo) {
    throw new Error(`Unknown operator: ${operator}`);
  }

  // Check if operator is variadic using the helper function
  const isVariadic = isOperatorVariadic(opInfo);

  // For date ranges with variadic operators, show both dates
  const isRangeOperator = isVariadic && parsedDate.rangeStart && parsedDate.rangeEnd;
  const displayDate = customLabel ??
    (isRangeOperator
      ? `${formatDateForDisplay(parsedDate.rangeStart!)} - ${formatDateForDisplay(parsedDate.rangeEnd!)}`
      : formatDateForDisplay(parsedDate.date));
  
  // Get translated column name for display
  const columnDisplayName = getTranslatedColumnName(column, i18nProvider);
  
  const label = `${columnDisplayName} ${opInfo.id} ${displayDate}`;

  // Use the original text for completion to preserve natural language
  const columnDisplayName = getTranslatedColumnName(column, i18nProvider);
  const completionText = `${columnDisplayName} ${operator} "${parsedDate.text}"`;

  // Build arguments array - either a range (2 dates) or a single date
  const args: HypothesisValueType[] = isRangeOperator
    ? [
        { kind: "date", value: parsedDate.rangeStart!, parsed: parsedDate },
        { kind: "date", value: parsedDate.rangeEnd!, parsed: parsedDate },
      ]
    : [{ kind: "date", value: parsedDate.date, parsed: parsedDate }];

  // Use range-specific ID if this is a range
  const suggestionId = isRangeOperator
    ? `${column.id}:${operator}:date:${parsedDate.rangeStart!.toISOString()}-${parsedDate.rangeEnd!.toISOString()}`
    : `${column.id}:${operator}:date:${parsedDate.date.toISOString()}`;

  // For range operators, parts.arguments should have two separate entries
  // so the UI renders [date1] [date2] instead of [date1 - date2]
  // Include the original text (e.g., "gestern") so the UI can show what input led to this date
  const originalText = parsedDate.text && parsedDate.text.toLowerCase() !== displayDate.toLowerCase() 
    ? parsedDate.text 
    : undefined;
  
  const argumentParts = isRangeOperator
    ? [
        { text: formatDateForDisplay(parsedDate.rangeStart!), originalText },
        { text: formatDateForDisplay(parsedDate.rangeEnd!), originalText },
      ]
    : [{ text: displayDate, originalText }];

  // Calculate query explanation score using the centralized scorer
  let finalScore: number;
  let scoreExplanation: import("./scorer.ts").ScoreExplanation | undefined;

  if (queryTokens && queryTokens.length > 0 && matchMetadata) {
    const result = calculateQueryExplanationScore(matchMetadata, queryTokens, args);
    finalScore = result.score;
    scoreExplanation = result.explanation;
  } else {
    // Fallback: use the passed score
    finalScore = score;
  }

  // Build queryMatches array from match metadata
  const queryMatches: QueryMatch[] = [];
  if (matchMetadata) {
    if (matchMetadata.column) {
      queryMatches.push({
        inputRange: {
          start: matchMetadata.column.inputStart,
          end: matchMetadata.column.inputEnd,
        },
        inputText: matchMetadata.column.inputText,
        matchType: "column",
        matchedTarget: matchMetadata.column.matchedTarget,
        matchedCharIndexes: matchMetadata.column.matchIndexes
          ? [...matchMetadata.column.matchIndexes]
          : undefined,
        score: matchMetadata.column.score,
      });
    }
    if (matchMetadata.operator) {
      queryMatches.push({
        inputRange: {
          start: matchMetadata.operator.inputStart,
          end: matchMetadata.operator.inputEnd,
        },
        inputText: matchMetadata.operator.inputText,
        matchType: "operator",
        matchedTarget: matchMetadata.operator.matchedTarget,
        matchedCharIndexes: matchMetadata.operator.matchIndexes
          ? [...matchMetadata.operator.matchIndexes]
          : undefined,
        score: matchMetadata.operator.score,
      });
    }
    if (matchMetadata.values) {
      for (const val of matchMetadata.values) {
        queryMatches.push({
          inputRange: { start: val.inputStart, end: val.inputEnd },
          inputText: val.inputText,
          matchType: "value",
          matchedTarget: val.matchedTarget,
          matchedCharIndexes: val.matchIndexes ? [...val.matchIndexes] : undefined,
          score: val.score,
        });
      }
    }
  }

  return {
    id: suggestionId,
    label,
    parts: {
      column: { text: columnDisplayName },
      operator: { text: opInfo.id },
      arguments: argumentParts,
    },
    column,
    operator,
    arguments: args,
    // Defer count computation to post-processing (lazy evaluation)
    // Use -1 as placeholder; counts are computed only for final suggestions
    resultCount: resultCount ?? -1,
    score: finalScore,
    isComplete: true,
    completionText,
    cursorPositionAfter: completionText.length,
    category: "fuzzy",
    queryMatches: queryMatches.length > 0 ? queryMatches : undefined,
    scoreExplanation,
  };
}

/**
 * Count rows matching a filter
 *
 * @param columnId - The column ID
 * @param operator - The operator
 * @param args - Optional arguments for the operator
 * @param data - The data array
 * @param contextRowIndices - Optional set of row indices to filter by
 * @returns The count of matching rows
 */
export function countForFilter(
  columnId: ColumnId,
  operator: Operator,
  args: HypothesisValueType[] | undefined,
  data: Array<Record<string, unknown>>,
  contextRowIndices: Set<number> | null = null
): number {
  // Determine which rows to iterate over
  const rowsToCheck =
    contextRowIndices !== null
      ? Array.from(contextRowIndices).map((i) => data[i]!)
      : data;

  // Handle no-argument operators (isTrue, isFalse, isEmpty, isNotEmpty)
  // These operators don't need arguments but still need to filter
  if (!args || args.length === 0) {
    // Check if this is a no-argument operator that still needs filtering
    if (
      operator === "isTrue" ||
      operator === "isFalse" ||
      operator === "isEmpty" ||
      operator === "isNotEmpty"
    ) {
      let count = 0;
      for (const row of rowsToCheck) {
        const cellValue = row[columnId as string];
        switch (operator) {
          case "isTrue":
            if (cellValue === true) count++;
            break;
          case "isFalse":
            if (cellValue === false) count++;
            break;
          case "isEmpty":
            if (cellValue == null || cellValue === "") count++;
            break;
          case "isNotEmpty":
            if (cellValue != null && cellValue !== "") count++;
            break;
        }
      }
      return count;
    }
    // For other operators without arguments, return total count
    return rowsToCheck.length;
  }

  const firstArg = args[0]!;

  // Handle single argument operators
  if (args.length === 1) {
    if (firstArg.kind === "string") {
      let count = 0;
      for (const row of rowsToCheck) {
        const cellValue = row[columnId as string];
        if (cellValue == null) continue;
        const strValue = String(cellValue);
        switch (operator) {
          case "eq":
            if (strValue === firstArg.value) count++;
            break;
          case "eqIgnoreCase":
            if (strValue.toLowerCase() === firstArg.value.toLowerCase()) count++;
            break;
          case "neq":
            if (strValue !== firstArg.value) count++;
            break;
          case "contains":
            if (strValue.includes(firstArg.value)) count++;
            break;
          case "startsWith":
            if (strValue.startsWith(firstArg.value)) count++;
            break;
          case "endsWith":
            if (strValue.endsWith(firstArg.value)) count++;
            break;
          default:
            count++;
        }
      }
      return count;
    }

    if (firstArg.kind === "number") {
      let count = 0;
      for (const row of rowsToCheck) {
        const cellValue = row[columnId as string];
        if (cellValue == null) continue;
        const numValue =
          typeof cellValue === "number" ? cellValue : parseFloat(String(cellValue));
        if (!isFinite(numValue)) continue;
        switch (operator) {
          case "eq":
            if (numValue === firstArg.value) count++;
            break;
          case "neq":
            if (numValue !== firstArg.value) count++;
            break;
          case "lt":
            if (numValue < firstArg.value) count++;
            break;
          case "lte":
            if (numValue <= firstArg.value) count++;
            break;
          case "gt":
            if (numValue > firstArg.value) count++;
            break;
          case "gte":
            if (numValue >= firstArg.value) count++;
            break;
          default:
            count++;
        }
      }
      return count;
    }

    if (firstArg.kind === "date") {
      let count = 0;
      const targetDate = firstArg.value;
      for (const row of rowsToCheck) {
        const cellValue = row[columnId as string];
        if (cellValue == null) continue;
        const dateValue =
          cellValue instanceof Date ? cellValue : new Date(String(cellValue));
        if (isNaN(dateValue.getTime())) continue;
        switch (operator) {
          case "eq":
            if (isSameDay(dateValue, targetDate)) count++;
            break;
          case "neq":
            if (!isSameDay(dateValue, targetDate)) count++;
            break;
          case "lt":
          case "before":
            if (dateValue < targetDate) count++;
            break;
          case "lte":
            if (dateValue <= targetDate || isSameDay(dateValue, targetDate)) count++;
            break;
          case "gt":
          case "after":
            if (dateValue > targetDate) count++;
            break;
          case "gte":
            if (dateValue >= targetDate || isSameDay(dateValue, targetDate)) count++;
            break;
          default:
            count++;
        }
      }
      return count;
    }
  }

  // Handle variadic operators (between, in, nin)
  if (args.length >= 2) {
    let count = 0;
    for (const row of rowsToCheck) {
      const cellValue = row[columnId as string];
      if (cellValue == null) continue;

      switch (operator) {
        case "between":
          const start = args[0]!;
          const end = args[1]!;
          if (start.kind === "number" && end.kind === "number") {
            const numValue =
              typeof cellValue === "number" ? cellValue : parseFloat(String(cellValue));
            if (isFinite(numValue) && numValue >= start.value && numValue <= end.value)
              count++;
          } else if (start.kind === "date" && end.kind === "date") {
            const dateValue =
              cellValue instanceof Date ? cellValue : new Date(String(cellValue));
            if (
              !isNaN(dateValue.getTime()) &&
              dateValue >= start.value &&
              dateValue <= end.value
            )
              count++;
          }
          break;
        case "in":
          if (
            args.some((arg) => {
              if (arg.kind === "number") {
                const numValue =
                  typeof cellValue === "number" ? cellValue : parseFloat(String(cellValue));
                return isFinite(numValue) && numValue === arg.value;
              }
              if (arg.kind === "string") {
                return String(cellValue) === arg.value;
              }
              return false;
            })
          )
            count++;
          break;
        case "nin":
          if (
            !args.some((arg) => {
              if (arg.kind === "number") {
                const numValue =
                  typeof cellValue === "number" ? cellValue : parseFloat(String(cellValue));
                return isFinite(numValue) && numValue === arg.value;
              }
              if (arg.kind === "string") {
                return String(cellValue) === arg.value;
              }
              return false;
            })
          )
            count++;
          break;
        default:
          count++;
      }
    }
    return count;
  }

  return rowsToCheck.length;
}

/**
 * Count rows matching a date filter
 *
 * @param columnId - The column ID
 * @param operator - The operator
 * @param parsedDate - The parsed date information
 * @param data - The data array
 * @param contextRowIndices - Optional set of row indices to filter by
 * @returns The count of matching rows
 */
export function countForDateFilter(
  columnId: ColumnId,
  operator: Operator,
  parsedDate: ParsedDate,
  data: Array<Record<string, unknown>>,
  contextRowIndices: Set<number> | null = null
): number {
  let count = 0;
  const targetDate = parsedDate.date;
  const rangeStart = parsedDate.rangeStart;
  const rangeEnd = parsedDate.rangeEnd;

  // Determine which rows to iterate over
  const rowsToCheck =
    contextRowIndices !== null
      ? Array.from(contextRowIndices).map((i) => data[i]!)
      : data;

  for (const row of rowsToCheck) {
    const cellValue = row[columnId as string];
    if (cellValue == null) continue;

    // Parse the cell value as a date
    const cellDate =
      cellValue instanceof Date ? cellValue : new Date(String(cellValue));

    if (isNaN(cellDate.getTime())) continue;

    switch (operator) {
      case "eq":
        // For date equality, compare just the date part (same day)
        if (isSameDay(cellDate, targetDate)) count++;
        break;
      case "neq":
        if (!isSameDay(cellDate, targetDate)) count++;
        break;
      case "lt":
      case "before":
        if (cellDate < targetDate) count++;
        break;
      case "lte":
        if (cellDate <= targetDate) count++;
        break;
      case "gt":
      case "after":
        if (cellDate > targetDate) count++;
        break;
      case "gte":
        if (cellDate >= targetDate) count++;
        break;
      case "between":
        if (rangeStart && rangeEnd) {
          if (cellDate >= rangeStart && cellDate <= rangeEnd) count++;
        }
        break;
      default:
        count++;
    }
  }

  return count;
}
