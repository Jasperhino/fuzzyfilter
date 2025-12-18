/**
 * Date Parser
 *
 * Wraps chrono-node for natural language date parsing.
 * Converts expressions like "today", "two weeks ago", "last month"
 * into Date objects for use in filter suggestions and execution.
 *
 * @module fuzzyfilter/date-parser
 */

import * as chrono from "chrono-node";
import type { ParsedDate, DateParseOptions } from "./types/parsing.ts";

/**
 * Common date expressions to suggest for date columns.
 * These are pre-defined phrases that users commonly type.
 */
export const COMMON_DATE_SUGGESTIONS = [
  { text: "today", label: "Today" },
  { text: "yesterday", label: "Yesterday" },
  { text: "tomorrow", label: "Tomorrow" },
  { text: "last week", label: "Last 7 days" },
  { text: "last month", label: "Last 30 days" },
  { text: "this week", label: "This week" },
  { text: "this month", label: "This month" },
  { text: "this year", label: "This year" },
] as const;

/**
 * A detected date expression with position information.
 */
export interface DateExpressionMatch {
  /** The original text that was parsed */
  text: string;
  /** Start position in the input string */
  start: number;
  /** End position in the input string */
  end: number;
  /** The parsed date information */
  parsed: ParsedDate;
}

/**
 * Parse a natural language date expression into a ParsedDate.
 *
 * Uses chrono-node to parse expressions like:
 * - Absolute: "2024-01-15", "January 15, 2024"
 * - Relative: "yesterday", "last week", "3 days ago", "two weeks ago"
 * - Future: "tomorrow", "next month", "in 2 weeks"
 * - Ranges: "last month", "this quarter" (returns rangeStart/rangeEnd)
 *
 * @param input - The text to parse for date expressions
 * @param options - Optional parsing configuration
 * @returns ParsedDate if a date was found, null otherwise
 *
 * @example
 * ```typescript
 * const result = parseDate("two weeks ago");
 * // → { date: Date, isRange: false, text: "two weeks ago", consumedText: "two weeks ago" }
 *
 * const range = parseDate("last month");
 * // → { date: Date, rangeStart: Date, rangeEnd: Date, isRange: true, ... }
 * ```
 */
export function parseDate(
  input: string,
  options?: DateParseOptions
): ParsedDate | null {
  if (!input || input.trim().length === 0) {
    return null;
  }

  const referenceDate = options?.referenceDate ?? new Date();
  const chronoOptions = {
    forwardDate: options?.forwardDate ?? false,
  };

  const results = chrono.parse(input, referenceDate, chronoOptions);

  if (results.length === 0) {
    return null;
  }

  // Take the first (most relevant) result
  const result = results[0]!;
  const startDate = result.start.date();

  // Check if this is a range expression (has end date)
  // Note: chrono-node sets result.end to null (not undefined) when no end date
  const hasEnd = result.end != null;
  const endDate = hasEnd ? result.end!.date() : undefined;

  // Determine if this is a range by checking for implied range expressions
  // or explicit end dates
  const isRange =
    hasEnd || isImpliedRangeExpression(input, result.text.toLowerCase());

  // For implied ranges without explicit end (like "last month"),
  // calculate the range based on the expression
  let rangeStart: Date | undefined;
  let rangeEnd: Date | undefined;

  if (isRange) {
    if (hasEnd) {
      rangeStart = startDate;
      rangeEnd = endDate;
    } else {
      // Calculate implied range
      const impliedRange = calculateImpliedRange(
        input.toLowerCase(),
        startDate,
        referenceDate
      );
      if (impliedRange) {
        rangeStart = impliedRange.start;
        rangeEnd = impliedRange.end;
      }
    }
  }

  return {
    date: startDate,
    rangeStart,
    rangeEnd,
    isRange,
    text: result.text,
    consumedText: result.text,
  };
}

/**
 * Detect all date expressions in the input string.
 *
 * Unlike parseDate() which returns only the first match,
 * this returns all date expressions with their positions.
 *
 * @param input - The text to scan for date expressions
 * @param options - Optional parsing configuration
 * @returns Array of matched date expressions with positions
 */
export function detectDateExpressions(
  input: string,
  options?: DateParseOptions
): DateExpressionMatch[] {
  if (!input || input.trim().length === 0) {
    return [];
  }

  const referenceDate = options?.referenceDate ?? new Date();
  const chronoOptions = {
    forwardDate: options?.forwardDate ?? false,
  };

  const results = chrono.parse(input, referenceDate, chronoOptions);

  return results.map((result) => {
    const startDate = result.start.date();
    // Note: chrono-node sets result.end to null (not undefined) when no end date
    const hasEnd = result.end != null;
    const endDate = hasEnd ? result.end!.date() : undefined;
    const isRange =
      hasEnd || isImpliedRangeExpression(input, result.text.toLowerCase());

    let rangeStart: Date | undefined;
    let rangeEnd: Date | undefined;

    if (isRange) {
      if (hasEnd) {
        rangeStart = startDate;
        rangeEnd = endDate;
      } else {
        const impliedRange = calculateImpliedRange(
          result.text.toLowerCase(),
          startDate,
          referenceDate
        );
        if (impliedRange) {
          rangeStart = impliedRange.start;
          rangeEnd = impliedRange.end;
        }
      }
    }

    return {
      text: result.text,
      start: result.index,
      end: result.index + result.text.length,
      parsed: {
        date: startDate,
        rangeStart,
        rangeEnd,
        isRange,
        text: result.text,
        consumedText: result.text,
      },
    };
  });
}

/**
 * Check if a date expression implies a range.
 */
function isImpliedRangeExpression(
  _fullInput: string,
  expressionText: string
): boolean {
  const rangePatterns = [
    /^last\s+(week|month|year|quarter)$/,
    /^this\s+(week|month|year|quarter)$/,
    /^next\s+(week|month|year|quarter)$/,
    /^past\s+\d+\s+(days?|weeks?|months?|years?)$/,
    /^(in|within)\s+the\s+(last|past)\s+\d+\s+(days?|weeks?|months?|years?)$/,
  ];

  return rangePatterns.some((pattern) => pattern.test(expressionText.trim()));
}

/**
 * Calculate the implied date range for expressions like "last month".
 */
function calculateImpliedRange(
  expressionText: string,
  parsedDate: Date,
  referenceDate: Date
): { start: Date; end: Date } | null {
  const text = expressionText.trim().toLowerCase();

  // "last week" - 7 days before reference to reference
  if (text === "last week") {
    const end = new Date(referenceDate);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  // "this week" - start of week to now
  if (text === "this week") {
    const start = new Date(referenceDate);
    const dayOfWeek = start.getDay();
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
    const end = new Date(referenceDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  // "last month" - 30 days before reference to reference
  if (text === "last month") {
    const end = new Date(referenceDate);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  // "this month" - start of month to now
  if (text === "this month") {
    const start = new Date(referenceDate);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(referenceDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  // "this year" - start of year to now
  if (text === "this year") {
    const start = new Date(referenceDate);
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(referenceDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  // "last year" - 365 days ago to reference
  if (text === "last year") {
    const end = new Date(referenceDate);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  // For other expressions, use the parsed date as both start and end of day
  const start = new Date(parsedDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(parsedDate);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Format a date for display in suggestions.
 *
 * @param date - The date to format
 * @param includeTime - Whether to include time in the format
 * @returns Formatted date string
 */
export function formatDateForDisplay(
  date: Date,
  includeTime: boolean = false
): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  };

  if (includeTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
  }

  return date.toLocaleDateString("en-US", options);
}

/**
 * Check if a string might be a date expression.
 * This is a quick check before running full chrono parsing.
 *
 * @param input - The text to check
 * @returns true if the input might contain a date expression
 */
export function mightBeDateExpression(input: string): boolean {
  if (!input || input.trim().length === 0) {
    return false;
  }

  const text = input.toLowerCase().trim();

  // Common date keywords
  const dateKeywords = [
    "today",
    "yesterday",
    "tomorrow",
    "ago",
    "last",
    "this",
    "next",
    "week",
    "month",
    "year",
    "day",
    "hour",
    "minute",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ];

  // Check for date keywords
  for (const keyword of dateKeywords) {
    if (text.includes(keyword)) {
      return true;
    }
  }

  // Check for date-like patterns (YYYY-MM-DD, MM/DD/YYYY, etc.)
  const datePatterns = [
    /\d{4}-\d{2}-\d{2}/, // ISO format
    /\d{1,2}\/\d{1,2}\/\d{2,4}/, // US format
    /\d{1,2}-\d{1,2}-\d{2,4}/, // Alternative format
    /\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i, // Day Month
  ];

  return datePatterns.some((pattern) => pattern.test(text));
}

