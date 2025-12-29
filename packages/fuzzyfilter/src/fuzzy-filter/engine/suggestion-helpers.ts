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
import { getOperator } from "../../operators.ts";
import { formatDateForDisplay } from "../../date-parser.ts";
import { SCORING_CONFIG } from "../constants.ts";

/**
 * Truncates a long value string to show the matched portion with ellipsis.
 * Shows context around the matched portion within a max width.
 *
 * @param value - The full value string
 * @param matchedIndexes - The matched character indexes (from fuzzy matching)
 * @param maxDisplayLength - Maximum display length (default: 30)
 * @returns Truncated string with ellipsis, or undefined if no truncation needed
 */
export function truncateWithEllipsis(
  value: string,
  matchedIndexes?: readonly number[],
  maxDisplayLength = 30
): string | undefined {
  // If value is short enough, no truncation needed
  if (value.length <= maxDisplayLength) {
    return undefined;
  }

  // If no match indexes, truncate from the start
  if (!matchedIndexes || matchedIndexes.length === 0) {
    return value.slice(0, maxDisplayLength - 1) + "…";
  }

  // Find the range of matched characters
  const firstMatchIdx = Math.min(...matchedIndexes);
  const lastMatchIdx = Math.max(...matchedIndexes);
  const matchLength = lastMatchIdx - firstMatchIdx + 1;

  // Calculate padding around the match
  const availableSpace = maxDisplayLength - matchLength - 2; // Reserve space for ellipses
  const paddingBefore = Math.floor(availableSpace / 2);
  const paddingAfter = Math.ceil(availableSpace / 2);

  // Calculate visible range
  let start = Math.max(0, firstMatchIdx - paddingBefore);
  let end = Math.min(value.length, lastMatchIdx + paddingAfter + 1);

  // Adjust if we're near the edges
  if (start === 0) {
    end = Math.min(value.length, maxDisplayLength - 1);
  } else if (end === value.length) {
    start = Math.max(0, value.length - maxDisplayLength + 1);
  }

  // Build truncated string with ellipsis
  const showStartEllipsis = start > 0;
  const showEndEllipsis = end < value.length;

  let result = value.slice(start, end);
  if (showStartEllipsis) {
    result = "…" + result;
  }
  if (showEndEllipsis) {
    result = result + "…";
  }

  return result;
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
  operator: Operator,
  args: HypothesisValueType[] | undefined,
  scoreOrBreakdown: number | ScoreBreakdown,
  resultCount?: number,
  matchedAlias?: string,
  matchMetadata?: MatchMetadata,
  queryTokens?: Token[]
): FilterSuggestion {
  const opInfo = getOperator(operator);

  // Format value text based on arguments
  let valueText = "";
  const argumentParts: { text: string; displayText?: string; highlight?: boolean }[] = [];

  if (args && args.length > 0) {
    const formattedValues = args
      .map((arg) => {
        if (arg.kind === "string") return arg.value;
        if (arg.kind === "number") return String(arg.value);
        if (arg.kind === "date") return formatDateForDisplay(arg.value);
        if (arg.kind === "boolean") return String(arg.value);
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
      const val = formattedValues[i]!;
      // Find the matching value in matchMetadata (if available)
      const valueMatch = matchMetadata?.values?.find((v) => v.matchedTarget === val);
      const displayText = truncateWithEllipsis(val, valueMatch?.matchIndexes);
      argumentParts.push({ text: val, displayText });
    }
  }

  // Use matched alias in label if provided, otherwise use operator label
  const operatorDisplay = matchedAlias ?? opInfo.label;
  const label = valueText
    ? `${column.name} ${operatorDisplay} ${valueText}`
    : `${column.name} ${operatorDisplay}`;

  const completionText = valueText
    ? `${column.name} ${operator} "${valueText}"`
    : `${column.name} ${operator} `;

  // Handle both plain score and breakdown
  const isBreakdown = typeof scoreOrBreakdown === "object";
  let score = isBreakdown ? scoreOrBreakdown.adjustedScore : scoreOrBreakdown;

  // Calculate token coverage bonus
  // Using more tokens from the query should give a bonus
  // This is proportional and capped so it doesn't override match quality
  if (queryTokens && queryTokens.length > 0 && matchMetadata) {
    const coveredTokenIndices = new Set<number>();

    // Helper to mark tokens as covered based on character range
    const markCoveredTokens = (inputStart: number, inputEnd: number) => {
      for (let i = 0; i < queryTokens!.length; i++) {
        const token = queryTokens![i]!;
        // A token is covered if its range overlaps with the match range
        if (token.start < inputEnd && token.end > inputStart) {
          coveredTokenIndices.add(i);
        }
      }
    };

    // Mark tokens covered by column match
    if (matchMetadata.column) {
      markCoveredTokens(matchMetadata.column.inputStart, matchMetadata.column.inputEnd);
    }

    // Mark tokens covered by operator match
    if (matchMetadata.operator) {
      markCoveredTokens(matchMetadata.operator.inputStart, matchMetadata.operator.inputEnd);
    }

    // Mark tokens covered by value matches
    if (matchMetadata.values) {
      for (const val of matchMetadata.values) {
        markCoveredTokens(val.inputStart, val.inputEnd);
      }
    }

    // For suggestions with detected numeric/date values (not string values from index),
    // mark the value tokens as covered if we have arguments
    if (args && args.length > 0) {
      for (const arg of args) {
        if (arg.kind === "number" || arg.kind === "date") {
          // Find the token that matches this value
          const valueStr = arg.kind === "number" ? String(arg.value) : "";
          for (let i = 0; i < queryTokens.length; i++) {
            const token = queryTokens[i]!;
            // Check if this token represents the numeric value
            if (arg.kind === "number" && token.text === valueStr) {
              coveredTokenIndices.add(i);
            }
            // For dates, check if the token could be part of a date expression
            if (arg.kind === "date" && !isNaN(parseFloat(token.text))) {
              coveredTokenIndices.add(i);
            }
          }
        }
      }
    }

    // Calculate token coverage bonus (proportional, max TOKEN_COVERAGE for full coverage)
    // This is a PRIMARY ranking factor - suggestions that explain more of the query
    // should score significantly higher than those that leave tokens unexplained.
    const coverageRatio = coveredTokenIndices.size / queryTokens.length;
    const tokenCoverageBonus = Math.round(coverageRatio * SCORING_CONFIG.BONUS.TOKEN_COVERAGE);
    score += tokenCoverageBonus;
  }

  const scoreBreakdown = isBreakdown
    ? {
        rawScore: scoreOrBreakdown.rawScore,
        coverageBonus: scoreOrBreakdown.coverageBonus,
        completenessBonus: scoreOrBreakdown.completenessBonus,
        fullQueryBonus: scoreOrBreakdown.fullQueryBonus,
        exactMatchBonus: scoreOrBreakdown.exactMatchBonus,
        tokenCount: scoreOrBreakdown.tokenCount,
        totalTokens: scoreOrBreakdown.totalTokens,
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
      column: { text: column.name },
      operator: {
        text: opInfo.label,
        symbol: opInfo.symbol,
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
      !opInfo.requiresArgument ||
      (args !== undefined &&
        args.length > 0 &&
        // Variadic operators may require a minimum number of arguments
        (!opInfo.isVariadic || args.length >= (opInfo.minArguments ?? 1))),
    completionText,
    cursorPositionAfter: completionText.length,
    category:
      score === 0
        ? "exact"
        : scoreBreakdown?.rawScore === 0
          ? "exact"
          : "fuzzy",
    queryMatches: queryMatches.length > 0 ? queryMatches : undefined,
  };
}

/**
 * Create a suggestion for a date value
 *
 * @param column - The column definition
 * @param operator - The operator
 * @param parsedDate - The parsed date information
 * @param score - The suggestion score
 * @param resultCount - Optional pre-computed result count
 * @param customLabel - Optional custom label for the date
 * @param matchMetadata - Optional metadata for highlighting
 * @returns A FilterSuggestion object
 */
export function createDateSuggestion(
  column: AnyColumnDefinition,
  operator: Operator,
  parsedDate: ParsedDate,
  score: number,
  resultCount?: number,
  customLabel?: string,
  matchMetadata?: MatchMetadata
): FilterSuggestion {
  const opInfo = getOperator(operator);

  // For date ranges with variadic operators, show both dates
  const isRangeOperator = opInfo.isVariadic && parsedDate.rangeStart && parsedDate.rangeEnd;
  const displayDate = customLabel ??
    (isRangeOperator
      ? `${formatDateForDisplay(parsedDate.rangeStart!)} - ${formatDateForDisplay(parsedDate.rangeEnd!)}`
      : formatDateForDisplay(parsedDate.date));
  const label = `${column.name} ${opInfo.label} ${displayDate}`;

  // Use the original text for completion to preserve natural language
  const completionText = `${column.name} ${operator} "${parsedDate.text}"`;

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
  const argumentParts = isRangeOperator
    ? [
        { text: formatDateForDisplay(parsedDate.rangeStart!) },
        { text: formatDateForDisplay(parsedDate.rangeEnd!) },
      ]
    : [{ text: displayDate }];

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
      column: { text: column.name },
      operator: { text: opInfo.label, symbol: opInfo.symbol },
      arguments: argumentParts,
    },
    column,
    operator,
    arguments: args,
    // Defer count computation to post-processing (lazy evaluation)
    // Use -1 as placeholder; counts are computed only for final suggestions
    resultCount: resultCount ?? -1,
    score,
    isComplete: true,
    completionText,
    cursorPositionAfter: completionText.length,
    category: "fuzzy",
    queryMatches: queryMatches.length > 0 ? queryMatches : undefined,
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
