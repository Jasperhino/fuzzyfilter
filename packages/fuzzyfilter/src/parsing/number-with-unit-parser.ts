/**
 * Generic Number With Unit Parser
 *
 * A universal parser that extracts numbers and fuzzy matches adjacent text
 * as units. The unit dimension determines the value type.
 *
 * Supports patterns:
 * - "100 kg" / "100kg" - number followed by unit
 * - "20%" / "20 percent" - number with percentage unit
 * - "50" - bare number (no unit)
 *
 * @module fuzzyfilter/parsing/number-with-unit-parser
 */

import type { Match } from "../types/core";
import type { UnitDefinition, UnitRegistry } from "../units/types";
import type { ParsedValue } from "./types";
import type { ValueParser } from "./value-parser";

/**
 * Result from parsing a number with optional unit.
 */
export interface NumberWithUnit {
  /** The numeric value */
  value: number;
  /** The matched unit (if any) */
  unit?: UnitDefinition;
  /** The dimension of the unit (e.g., 'mass', 'percentage') */
  dimension?: string;
  /** Converted value in base units (if unit matched) */
  baseValue?: number;
}

/**
 * Configuration for the NumberWithUnitParser.
 */
export interface NumberWithUnitParserConfig {
  /**
   * If specified, only match units from this dimension.
   * If not specified, match units from all dimensions.
   */
  dimension?: string;

  /**
   * Minimum fuzzy match score for units (0-1).
   * @default 0.6
   */
  minUnitScore?: number;

  /**
   * Whether to include bare numbers (no unit) in results.
   * @default true
   */
  allowBareNumbers?: boolean;

  /**
   * Score for bare numbers (no unit matched).
   * @default 0.7
   */
  bareNumberScore?: number;
}

/**
 * Create a generic number-with-unit parser.
 *
 * This parser extracts all numbers from the query and attempts to
 * fuzzy match adjacent text as units from the UnitRegistry.
 *
 * @example
 * ```typescript
 * const parser = createNumberWithUnitParser({ dimension: 'mass' });
 * const results = parser.parse('100 kg', unitRegistry);
 * // [{ value: { value: 100, unit: kg, dimension: 'mass' }, ... }]
 *
 * const percentParser = createNumberWithUnitParser({ dimension: 'percentage' });
 * const results2 = percentParser.parse('20%', unitRegistry);
 * // [{ value: { value: 20, unit: %, dimension: 'percentage' }, ... }]
 * ```
 */
export function createNumberWithUnitParser(
  config: NumberWithUnitParserConfig = {}
): ValueParser<NumberWithUnit> {
  const {
    dimension,
    minUnitScore = 0.6,
    allowBareNumbers = true,
    bareNumberScore = 0.7,
  } = config;

  const type = dimension ? `number:${dimension}` : "number:any";

  return {
    type,
    expectedDimension: dimension,

    parse(query: string, unitRegistry: UnitRegistry): ParsedValue<NumberWithUnit>[] {
      const results: ParsedValue<NumberWithUnit>[] = [];

      // Extract all numbers with their positions
      const numbers = extractNumbersWithPositions(query);

      for (const num of numbers) {
        // Look for unit text AFTER the number
        const afterUnit = extractUnitTextAfter(query, num.end);
        // Look for unit text BEFORE the number (e.g., "$100" or "%20" in some locales)
        const beforeUnit = extractUnitTextBefore(query, num.start);

        // Try matching unit text after number
        if (afterUnit) {
          const unitMatches = unitRegistry.search(afterUnit.text, dimension, 3);
          for (const um of unitMatches) {
            if (um.score >= minUnitScore) {
              results.push(createResult(num, um, afterUnit, query));
            }
          }
        }

        // Try matching unit text before number (less common but valid)
        if (beforeUnit) {
          const unitMatches = unitRegistry.search(beforeUnit.text, dimension, 3);
          for (const um of unitMatches) {
            if (um.score >= minUnitScore) {
              results.push(createResult(num, um, beforeUnit, query, true));
            }
          }
        }

        // Also try the number alone (without unit context) against all dimensions
        // This handles cases like "20%" where % is right after
        const immediateAfter = query.slice(num.end, num.end + 10).trim();
        if (immediateAfter && !afterUnit) {
          // Check for special characters like %
          const specialMatch = immediateAfter.match(/^([%$€£¥]|percent|pct)/i);
          if (specialMatch) {
            const unitMatches = unitRegistry.search(specialMatch[1], dimension, 3);
            for (const um of unitMatches) {
              if (um.score >= minUnitScore) {
                results.push({
                  value: {
                    value: num.value,
                    unit: um.item,
                    dimension: um.item.dimension,
                    baseValue: num.value * um.item.toBase,
                  },
                  unit: um,
                  rawText: num.text + specialMatch[0],
                  start: num.start,
                  end: num.end + specialMatch[0].length,
                  score: um.score,
                });
              }
            }
          }
        }

        // Add bare number if allowed and we haven't found any unit matches for this number
        if (allowBareNumbers) {
          const hasUnitMatch = results.some(
            (r) => r.start === num.start && r.value.unit !== undefined
          );
          if (!hasUnitMatch) {
            results.push({
              value: {
                value: num.value,
                dimension: undefined,
              },
              rawText: num.text,
              start: num.start,
              end: num.end,
              score: bareNumberScore,
            });
          }
        }
      }

      // Sort by score descending
      return results.sort((a, b) => b.score - a.score);
    },
  };

  function createResult(
    num: NumberMatch,
    unitMatch: Match<UnitDefinition>,
    unitText: TextSpan,
    query: string,
    unitBefore = false
  ): ParsedValue<NumberWithUnit> {
    const start = unitBefore ? unitText.start : num.start;
    const end = unitBefore ? num.end : unitText.end;
    const rawText = query.slice(start, end);

    return {
      value: {
        value: num.value,
        unit: unitMatch.item,
        dimension: unitMatch.item.dimension,
        baseValue: num.value * unitMatch.item.toBase,
      },
      unit: unitMatch,
      rawText,
      start,
      end,
      score: unitMatch.score,
    };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

interface NumberMatch {
  value: number;
  text: string;
  start: number;
  end: number;
}

interface TextSpan {
  text: string;
  start: number;
  end: number;
}

/**
 * Extract all numbers from the query with their positions.
 * Handles integers and decimals.
 */
function extractNumbersWithPositions(query: string): NumberMatch[] {
  const results: NumberMatch[] = [];
  const regex = /\d+(?:[.,]\d+)?/g;
  let match;

  while ((match = regex.exec(query)) !== null) {
    // Normalize decimal separator
    const text = match[0];
    const normalized = text.replace(",", ".");
    results.push({
      value: parseFloat(normalized),
      text,
      start: match.index,
      end: match.index + text.length,
    });
  }

  return results;
}

/**
 * Extract potential unit text after a number.
 * Skips whitespace and extracts alphabetic text.
 */
function extractUnitTextAfter(query: string, numberEnd: number): TextSpan | null {
  // Skip optional whitespace
  let start = numberEnd;
  while (start < query.length && /\s/.test(query[start]!)) {
    start++;
  }

  // Extract alphabetic text (and common unit chars)
  let end = start;
  while (end < query.length && /[a-zA-Z]/.test(query[end]!)) {
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
 * Extract potential unit text before a number.
 * Used for currency symbols and other prefix units.
 */
function extractUnitTextBefore(query: string, numberStart: number): TextSpan | null {
  // Skip optional whitespace backwards
  let end = numberStart;
  while (end > 0 && /\s/.test(query[end - 1]!)) {
    end--;
  }

  // Extract alphabetic/symbol text backwards
  let start = end;
  while (start > 0 && /[a-zA-Z$€£¥%]/.test(query[start - 1]!)) {
    start--;
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
 * Create a parser specifically for percentages.
 * Convenience wrapper around createNumberWithUnitParser.
 */
export function createPercentageParser(): ValueParser<NumberWithUnit> {
  return createNumberWithUnitParser({
    dimension: "percentage",
    allowBareNumbers: false, // Percentages need the % or percent
  });
}

/**
 * Create a parser specifically for mass/weight.
 * Convenience wrapper around createNumberWithUnitParser.
 */
export function createMassParser(): ValueParser<NumberWithUnit> {
  return createNumberWithUnitParser({
    dimension: "mass",
    allowBareNumbers: true,
  });
}

/**
 * Create a universal number parser that matches any dimension.
 * The matched dimension determines the value type.
 */
export function createUniversalNumberParser(): ValueParser<NumberWithUnit> {
  return createNumberWithUnitParser({
    dimension: undefined, // Match any dimension
    allowBareNumbers: true,
  });
}
