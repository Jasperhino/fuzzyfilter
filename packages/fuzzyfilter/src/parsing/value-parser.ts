/**
 * Value Parser Interface
 *
 * Defines the interface for unit-aware value parsers.
 * Parsers are user-provided - no built-in parsers included.
 *
 * @module fuzzyfilter/parsing/value-parser
 */

import type { Match } from "../types/core";
import type { UnitDefinition, UnitRegistry } from "../units/types";
import type { ParseContext, ParsedValue, ValueSuggestion } from "./types";

/**
 * Interface for parsing typed values from user input.
 *
 * Value parsers extract structured data from query strings,
 * optionally with unit information. They support the beam search
 * paradigm by returning multiple possible interpretations.
 *
 * @typeParam T - The type of value this parser produces
 *
 * @example
 * ```typescript
 * class AmountParser implements ValueParser<{ value: number; unit?: string }> {
 *   readonly type = 'amount';
 *   readonly expectedDimension = 'mass';
 *
 *   parse(query: string, unitRegistry: UnitRegistry): ParsedValue<{ value: number; unit?: string }>[] {
 *     const results: ParsedValue<{ value: number; unit?: string }>[] = [];
 *     const regex = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/g;
 *     let match;
 *
 *     while ((match = regex.exec(query)) !== null) {
 *       const numValue = parseFloat(match[1]);
 *       const unitText = match[2];
 *
 *       if (unitText) {
 *         const unitMatches = unitRegistry.search(unitText, this.expectedDimension);
 *         for (const um of unitMatches) {
 *           results.push({
 *             value: { value: numValue, unit: um.item.id },
 *             unit: um,
 *             rawText: match[0],
 *             start: match.index,
 *             end: match.index + match[0].length,
 *             score: um.score,
 *           });
 *         }
 *       }
 *
 *       // Also consider number without unit
 *       results.push({
 *         value: { value: numValue },
 *         rawText: match[1],
 *         start: match.index,
 *         end: match.index + match[1].length,
 *         score: unitText ? 0.8 : 0.9, // Lower if unit text was present but not matched
 *       });
 *     }
 *
 *     return results;
 *   }
 * }
 * ```
 */
export interface ValueParser<T = unknown> {
  /**
   * Type identifier for this parser.
   * Used for registry lookup and debugging.
   */
  readonly type: string;

  /**
   * Expected unit dimension for this parser's values.
   * Used to filter unit suggestions and validate matches.
   *
   * @example 'mass', 'currency', 'length', 'time'
   */
  readonly expectedDimension?: string;

  /**
   * Parse the query string and return all possible interpretations.
   *
   * Following beam search principles:
   * - Return multiple results when input is ambiguous
   * - Don't commit to a single interpretation early
   * - Each result has a score indicating parse quality
   *
   * @param query - The text to parse
   * @param unitRegistry - Registry for unit lookup and fuzzy matching
   * @param context - Optional context about current parse state
   * @returns Array of parsed values with scores, sorted by score (best first)
   */
  parse(
    query: string,
    unitRegistry: UnitRegistry,
    context?: ParseContext
  ): ParsedValue<T>[];

  /**
   * Get autocomplete suggestions for partial input.
   * Optional - not all parsers need to support suggestions.
   *
   * @param partial - The partial input text
   * @param unitRegistry - Registry for unit suggestions
   * @returns Array of suggestions sorted by score (best first)
   */
  suggest?(partial: string, unitRegistry: UnitRegistry): ValueSuggestion[];
}

/**
 * Registry of value parsers keyed by type name.
 */
export type ValueParserRegistry = Map<string, ValueParser<unknown>>;

/**
 * Create a value parser registry from an array of parsers.
 */
export function createValueParserRegistry(
  parsers: ValueParser<unknown>[]
): ValueParserRegistry {
  const registry = new Map<string, ValueParser<unknown>>();
  for (const parser of parsers) {
    registry.set(parser.type, parser);
  }
  return registry;
}

/**
 * Helper to create a ParsedValue result.
 * Ensures consistent structure and score bounds.
 */
export function createParsedValue<T>(
  value: T,
  rawText: string,
  start: number,
  end: number,
  score: number,
  unit?: Match<UnitDefinition>
): ParsedValue<T> {
  return {
    value,
    unit,
    rawText,
    start,
    end,
    // Ensure score is in valid range
    score: Math.min(1, Math.max(0, score)),
  };
}

/**
 * Helper to extract numbers from a query string.
 * Returns all numeric values with their positions.
 */
export function extractNumbers(
  query: string
): Array<{ value: number; text: string; start: number; end: number }> {
  const results: Array<{
    value: number;
    text: string;
    start: number;
    end: number;
  }> = [];
  const regex = /\d+(?:\.\d+)?/g;
  let match;

  while ((match = regex.exec(query)) !== null) {
    results.push({
      value: parseFloat(match[0]),
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return results;
}

/**
 * Helper to extract text following a number.
 * Useful for finding potential unit text.
 */
export function extractUnitTextAfterNumber(
  query: string,
  numberEnd: number
): { text: string; start: number; end: number } | null {
  // Skip optional whitespace
  let start = numberEnd;
  while (start < query.length && /\s/.test(query[start])) {
    start++;
  }

  // Extract alphabetic text
  let end = start;
  while (end < query.length && /[a-zA-Z]/.test(query[end])) {
    end++;
  }

  if (end > start) {
    return {
      text: query.slice(start, end),
      start,
      end,
    };
  }

  return null;
}

/**
 * Calculate a composite score from multiple factors.
 * Uses multiplicative scoring to stay in (0,1] range.
 */
export function multiplyScores(...factors: number[]): number {
  let result = 1;
  for (const factor of factors) {
    result *= Math.min(1, Math.max(0, factor));
  }
  return result;
}
