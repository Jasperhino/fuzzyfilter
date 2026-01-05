/**
 * Date Parser
 *
 * Thin wrapper around chrono-node for natural language date parsing.
 * Adds custom logic to merge consecutive dates like "yesterday today" into ranges
 * and to treat expressions like "last week" as date ranges.
 *
 * Supports multiple locales through chrono-node's built-in language support.
 *
 * @module fuzzyfilter/date-parser
 */

import * as chrono from "chrono-node";
import type { ParsingResult, ParsedResult, Refiner, ParsingContext, Chrono } from "chrono-node";
import type { ParsedDate, DateParseOptions } from "./types/parsing.ts";

/**
 * Supported date parsing locales.
 * Maps to chrono-node's built-in language parsers.
 */
export type DateLocale = "en" | "de" | "fr" | "es" | "nl" | "ja" | "pt";

// ============================================================================
// CUSTOM CHRONO REFINER
// ============================================================================

/**
 * Custom refiner that merges consecutive date expressions into a single date range.
 *
 * This handles cases like "yesterday today" where chrono-node returns two separate
 * date expressions instead of a single range (unlike "yesterday - today" which
 * chrono-node naturally parses as a range).
 *
 * @see https://github.com/wanasit/chrono?tab=readme-ov-file#refiner
 */
const mergeConsecutiveDatesRefiner: Refiner = {
  refine: (context: ParsingContext, results: ParsingResult[]): ParsingResult[] => {
    if (results.length < 2) {
      return results;
    }

    const mergedResults: ParsingResult[] = [];
    let i = 0;

    while (i < results.length) {
      const current = results[i]!;
      const next = results[i + 1];

      // Check if we can merge current with next (adjacent, whitespace only gap)
      if (next && canMerge(context.text, current, next)) {
        const mergedResult = current.clone();

        // Determine which date is earlier and set start/end appropriately
        const currentDate = current.start.date();
        const nextDate = next.start.date();

        if (currentDate <= nextDate) {
          mergedResult.end = next.start.clone();
        } else {
          // Swap: next is the start, current is the end
          mergedResult.end = current.start.clone();
          for (const key of ["year", "month", "day", "hour", "minute", "second", "millisecond"] as const) {
            const val = next.start.get(key);
            if (val !== null) {
              mergedResult.start.assign(key, val);
            }
          }
        }

        // Update text span to include both expressions
        const startIndex = Math.min(current.index, next.index);
        const endIndex = Math.max(current.index + current.text.length, next.index + next.text.length);
        (mergedResult as { index: number }).index = startIndex;
        (mergedResult as { text: string }).text = context.text.substring(startIndex, endIndex);

        mergedResults.push(mergedResult);
        i += 2;
      } else {
        mergedResults.push(current);
        i += 1;
      }
    }

    return mergedResults;
  },
};

/**
 * Check if two parsing results can be merged into a date range.
 */
function canMerge(text: string, current: ParsingResult, next: ParsingResult): boolean {
  // Don't merge if either already has an end date
  if (current.end != null || next.end != null) {
    return false;
  }

  const currentEnd = current.index + current.text.length;
  const nextStart = next.index;

  if (nextStart < currentEnd) {
    return false; // Overlapping
  }

  // Allow only whitespace between dates
  return /^\s*$/.test(text.substring(currentEnd, nextStart));
}

// ============================================================================
// CUSTOM CHRONO INSTANCES (per locale)
// ============================================================================

/**
 * Creates a custom chrono instance with date range merging support for a locale.
 */
function createCustomChrono(baseChrono: Chrono): Chrono {
  const custom = baseChrono.clone();
  custom.refiners.push(mergeConsecutiveDatesRefiner);
  return custom;
}

/**
 * Locale-specific chrono instances with date range merging support.
 * Uses chrono-node's built-in locale parsers.
 */
const chronoByLocale: Record<DateLocale, Chrono> = {
  en: createCustomChrono(chrono.en.casual),
  de: createCustomChrono(chrono.de.casual),
  fr: createCustomChrono(chrono.fr.casual),
  es: createCustomChrono(chrono.es.casual),
  nl: createCustomChrono(chrono.nl.casual),
  ja: createCustomChrono(chrono.ja.casual),
  pt: createCustomChrono(chrono.pt.casual),
};

/**
 * Get the chrono instance for a specific locale.
 * Falls back to English if locale not supported.
 */
function getChronoForLocale(locale?: DateLocale): Chrono {
  if (locale && locale in chronoByLocale) {
    return chronoByLocale[locale];
  }
  return chronoByLocale.en;
}

// Keep backward compatibility
const customChrono = chronoByLocale.en;

// ============================================================================
// IMPLIED RANGE PATTERNS
// ============================================================================

/** Patterns that should be treated as date ranges even though chrono returns single dates */
const IMPLIED_RANGE_PATTERNS = [
  /^last\s+(week|month|year|quarter)$/,
  /^this\s+(week|month|year|quarter)$/,
  /^next\s+(week|month|year|quarter)$/,
  /^past\s+\d+\s+(days?|weeks?|months?|years?)$/,
  /^(in|within)\s+the\s+(last|past)\s+\d+\s+(days?|weeks?|months?|years?)$/,
];

/**
 * Check if a date expression implies a range.
 */
function isImpliedRange(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return IMPLIED_RANGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Calculate the date range for implied range expressions.
 */
function calculateImpliedRange(text: string, referenceDate: Date): { start: Date; end: Date } | null {
  const normalized = text.trim().toLowerCase();

  const ranges: Record<string, () => { start: Date; end: Date }> = {
    "last week": () => {
      const end = new Date(referenceDate);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    },
    "this week": () => {
      const start = new Date(referenceDate);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(referenceDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
    "last month": () => {
      const end = new Date(referenceDate);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    },
    "this month": () => {
      const start = new Date(referenceDate);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(referenceDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
    "this year": () => {
      const start = new Date(referenceDate);
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(referenceDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    },
    "last year": () => {
      const end = new Date(referenceDate);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    },
  };

  return ranges[normalized]?.() ?? null;
}

// ============================================================================
// LRU CACHE FOR DATE PARSING
// ============================================================================

/**
 * Simple LRU cache for date parsing results.
 * Caches parsed dates to avoid repeated chrono-node calls for the same input.
 */
class DateParseCache {
  private cache = new Map<string, { result: ParsedDate | null; timestamp: number }>();
  private readonly maxSize: number;
  private readonly maxAge: number; // ms

  constructor(maxSize = 100, maxAgeMs = 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.maxAge = maxAgeMs;
  }

  /**
   * Generates a cache key that includes the day and locale to handle date-relative expressions.
   * Cache is invalidated daily since "today" means different things on different days.
   * Locale is included since "gestern" only works with German locale, not English.
   */
  private getCacheKey(input: string, referenceDate?: Date, locale?: string): string {
    const date = referenceDate ?? new Date();
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const localeKey = locale?.toLowerCase().split("-")[0] ?? "en";
    return `${input.toLowerCase().trim()}:${dayKey}:${localeKey}`;
  }

  get(input: string, referenceDate?: Date, locale?: string): ParsedDate | null | undefined {
    const key = this.getCacheKey(input, referenceDate, locale);
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used) by deleting and re-adding
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.result;
  }

  set(input: string, result: ParsedDate | null, referenceDate?: Date, locale?: string): void {
    const key = this.getCacheKey(input, referenceDate, locale);

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/** Global cache instance for date parsing */
const dateParseCache = new DateParseCache();

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Common date expressions to suggest for date columns.
 * These are the English defaults.
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
 * Locale-specific date suggestions.
 * Keys match what chrono-node understands for each locale.
 */
const DATE_SUGGESTIONS_BY_LOCALE: Record<DateLocale, Array<{ text: string; label: string }>> = {
  en: [
    { text: "today", label: "Today" },
    { text: "yesterday", label: "Yesterday" },
    { text: "tomorrow", label: "Tomorrow" },
    { text: "last week", label: "Last 7 days" },
    { text: "last month", label: "Last 30 days" },
    { text: "this week", label: "This week" },
    { text: "this month", label: "This month" },
    { text: "this year", label: "This year" },
  ],
  de: [
    { text: "heute", label: "Heute" },
    { text: "gestern", label: "Gestern" },
    { text: "morgen", label: "Morgen" },
    { text: "letzte Woche", label: "Letzte 7 Tage" },
    { text: "letzten Monat", label: "Letzte 30 Tage" },
    { text: "diese Woche", label: "Diese Woche" },
    { text: "diesen Monat", label: "Diesen Monat" },
    { text: "dieses Jahr", label: "Dieses Jahr" },
  ],
  fr: [
    { text: "aujourd'hui", label: "Aujourd'hui" },
    { text: "hier", label: "Hier" },
    { text: "demain", label: "Demain" },
    { text: "la semaine dernière", label: "7 derniers jours" },
    { text: "le mois dernier", label: "30 derniers jours" },
    { text: "cette semaine", label: "Cette semaine" },
    { text: "ce mois", label: "Ce mois" },
    { text: "cette année", label: "Cette année" },
  ],
  es: [
    { text: "hoy", label: "Hoy" },
    { text: "ayer", label: "Ayer" },
    { text: "mañana", label: "Mañana" },
    { text: "la semana pasada", label: "Últimos 7 días" },
    { text: "el mes pasado", label: "Últimos 30 días" },
    { text: "esta semana", label: "Esta semana" },
    { text: "este mes", label: "Este mes" },
    { text: "este año", label: "Este año" },
  ],
  nl: [
    { text: "vandaag", label: "Vandaag" },
    { text: "gisteren", label: "Gisteren" },
    { text: "morgen", label: "Morgen" },
    { text: "vorige week", label: "Afgelopen 7 dagen" },
    { text: "vorige maand", label: "Afgelopen 30 dagen" },
    { text: "deze week", label: "Deze week" },
    { text: "deze maand", label: "Deze maand" },
    { text: "dit jaar", label: "Dit jaar" },
  ],
  ja: [
    { text: "今日", label: "今日" },
    { text: "昨日", label: "昨日" },
    { text: "明日", label: "明日" },
    { text: "先週", label: "先週" },
    { text: "先月", label: "先月" },
    { text: "今週", label: "今週" },
    { text: "今月", label: "今月" },
    { text: "今年", label: "今年" },
  ],
  pt: [
    { text: "hoje", label: "Hoje" },
    { text: "ontem", label: "Ontem" },
    { text: "amanhã", label: "Amanhã" },
    { text: "semana passada", label: "Últimos 7 dias" },
    { text: "mês passado", label: "Últimos 30 dias" },
    { text: "esta semana", label: "Esta semana" },
    { text: "este mês", label: "Este mês" },
    { text: "este ano", label: "Este ano" },
  ],
};

/**
 * Get common date suggestions for a specific locale.
 * Falls back to English if locale not supported.
 * 
 * @param locale - The locale code (e.g., "de", "fr", "es")
 * @returns Array of date suggestions with text and label
 */
export function getDateSuggestionsForLocale(locale?: DateLocale | string): Array<{ text: string; label: string }> {
  const normalizedLocale = (locale?.toLowerCase().split("-")[0] ?? "en") as DateLocale;
  return DATE_SUGGESTIONS_BY_LOCALE[normalizedLocale] ?? DATE_SUGGESTIONS_BY_LOCALE.en;
}

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
 * Convert a chrono ParsedResult to our ParsedDate type.
 */
function toParsedDate(result: ParsedResult, referenceDate: Date): ParsedDate {
  const startDate = result.start.date();
  const hasEnd = result.end != null;
  const endDate = hasEnd ? result.end!.date() : undefined;

  // Check for implied range (like "last week")
  const impliedRange = !hasEnd && isImpliedRange(result.text)
    ? calculateImpliedRange(result.text, referenceDate)
    : null;

  const isRange = hasEnd || impliedRange != null;
  const rangeStart = hasEnd ? startDate : impliedRange?.start;
  const rangeEnd = hasEnd ? endDate : impliedRange?.end;

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
 * Parse a natural language date expression into a ParsedDate.
 *
 * Uses chrono-node with our custom refiner that merges consecutive dates.
 * Supports multiple locales through chrono-node's built-in language parsers.
 *
 * @param input - The text to parse for date expressions
 * @param options - Optional parsing configuration (includes locale)
 * @returns ParsedDate if a date was found, null otherwise
 *
 * @example
 * ```typescript
 * parseDate("yesterday today");
 * // → { date: Date, rangeStart: Date, rangeEnd: Date, isRange: true, text: "yesterday today" }
 *
 * parseDate("gestern", { locale: "de" });
 * // → { date: Date, isRange: false, text: "gestern" }
 *
 * parseDate("last week");
 * // → { date: Date, rangeStart: Date, rangeEnd: Date, isRange: true, text: "last week" }
 * ```
 */
export function parseDate(input: string, options?: DateParseOptions): ParsedDate | null {
  if (!input?.trim()) {
    return null;
  }

  const referenceDate = options?.referenceDate ?? new Date();
  const locale = (options?.locale?.toLowerCase().split("-")[0] ?? "en") as DateLocale;

  // Check cache first (only for standard options)
  // Include locale in cache key to ensure locale-specific parsing
  if (!options?.forwardDate) {
    const cached = dateParseCache.get(input, referenceDate, locale);
    if (cached !== undefined) {
      return cached;
    }
  }

  // Use locale-specific chrono parser
  const chronoInstance = getChronoForLocale(locale);
  const results = chronoInstance.parse(input, referenceDate, {
    forwardDate: options?.forwardDate ?? false,
  });

  const result = results.length === 0 ? null : toParsedDate(results[0]!, referenceDate);

  // Cache the result (only for standard options)
  if (!options?.forwardDate) {
    dateParseCache.set(input, result, referenceDate, locale);
  }

  return result;
}

/**
 * Detect all date expressions in the input string.
 *
 * @param input - The text to scan for date expressions
 * @param options - Optional parsing configuration
 * @returns Array of matched date expressions with positions
 */
export function detectDateExpressions(input: string, options?: DateParseOptions): DateExpressionMatch[] {
  if (!input?.trim()) {
    return [];
  }

  const referenceDate = options?.referenceDate ?? new Date();
  const results = customChrono.parse(input, referenceDate, {
    forwardDate: options?.forwardDate ?? false,
  });

  return results.map((result) => ({
    text: result.text,
    start: result.index,
    end: result.index + result.text.length,
    parsed: toParsedDate(result, referenceDate),
  }));
}

/**
 * Format a date for display in suggestions.
 *
 * @param date - The date to format
 * @param includeTime - Whether to include time in the format
 * @returns Formatted date string
 */
export function formatDateForDisplay(date: Date, includeTime = false): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime && { hour: "2-digit", minute: "2-digit" }),
  };
  return date.toLocaleDateString("en-US", options);
}

/**
 * Quick check if a string might be a date expression.
 * Faster than running full chrono parsing.
 *
 * @param input - The text to check
 * @returns true if the input might contain a date expression
 */
export function mightBeDateExpression(input: string): boolean {
  if (!input?.trim()) {
    return false;
  }

  const text = input.toLowerCase();

  // Check for common date keywords
  const keywords = [
    "today", "yesterday", "tomorrow", "ago", "last", "this", "next",
    "week", "month", "year", "day", "hour", "minute",
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
    "mon", "tue", "wed", "thu", "fri", "sat", "sun",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ];

  if (keywords.some((kw) => text.includes(kw))) {
    return true;
  }

  // Check for date-like patterns
  return /\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(text);
}
