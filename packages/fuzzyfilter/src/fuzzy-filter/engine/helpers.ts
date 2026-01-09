/**
 * Helper utilities for fuzzy filter operations
 */

import type { Token, HypothesisValueType } from "../../types/index.ts";
import type { DetectedValues, PositionedValueMatch } from "../types.ts";
import { parseDate, type ParsedDate } from "../../date-parser.ts";

/**
 * Detect tokens that are potential argument values (numbers or dates).
 * Excludes tokens that are already used for column/operator matching.
 *
 * @param tokens - The tokens to analyze
 * @param usedTokenIndices - Set of token indices already used for other purposes
 * @param locale - Optional locale for date parsing (e.g., "de" for German "gestern")
 * @returns Detected numeric and date values
 */
export function detectValueTokens(
  tokens: Token[],
  usedTokenIndices: Set<number>,
  locale?: string
): DetectedValues {
  const result: DetectedValues = {
    numbers: [],
    dates: [],
  };

  // Track which tokens we've already used
  const processedIndices = new Set<number>();

  // First, try to detect multi-token date expressions (e.g., "two weeks ago", "last week")
  // Start from each unused token and try to form date expressions with subsequent tokens
  for (let start = 0; start < tokens.length; start++) {
    if (usedTokenIndices.has(start) || processedIndices.has(start)) continue;

    // Try sequences of 1-5 tokens (most date expressions are short)
    for (let end = start + 1; end <= Math.min(start + 5, tokens.length); end++) {
      if (usedTokenIndices.has(end - 1)) break;
      
      const dateTokens = tokens.slice(start, end);
      const dateText = dateTokens.map(t => t.text).join(" ");
      const parsedDate = parseDate(dateText, { locale });
      
      if (parsedDate) {
        // Found a date expression spanning multiple tokens
        // Create a synthetic token that spans all the tokens in the date expression
        const firstToken = dateTokens[0]!;
        const lastToken = dateTokens[dateTokens.length - 1]!;
        const syntheticToken: Token = {
          text: dateText,
          normalized: dateText.toLowerCase(),
          start: firstToken.start,
          end: lastToken.end,
          quoted: false,
        };
        
        result.dates.push({ 
          token: syntheticToken, 
          value: parsedDate.date, 
          index: start,
          parsed: parsedDate
        });
        
        // Mark all tokens in this sequence as processed
        for (let idx = start; idx < end; idx++) {
          processedIndices.add(idx);
        }
        break; // Found a match, don't try longer sequences starting from this position
      }
    }
  }

  // Then check remaining single tokens for numbers and single-token dates
  for (let i = 0; i < tokens.length; i++) {
    if (usedTokenIndices.has(i) || processedIndices.has(i)) continue;

    const token = tokens[i]!;

    // Check if it's a numeric literal
    const num = parseFloat(token.text);
    if (isFinite(num)) {
      result.numbers.push({ token, value: num, index: i });
      continue;
    }

    // Check if it's a single-token date expression (already checked multi-token above)
    const parsedDate = parseDate(token.text, { locale });
    if (parsedDate) {
      result.dates.push({ token, value: parsedDate.date, index: i, parsed: parsedDate });
    }
  }

  return result;
}

/**
 * Select a non-overlapping subset of value matches.
 * Uses a greedy algorithm: sort by score descending, pick highest scoring
 * match that doesn't overlap with already selected matches.
 *
 * This solves the weighted interval scheduling problem approximately,
 * ensuring each character position in the input is only "spent" once.
 *
 * @param matches - All candidate matches for a column
 * @param excludedPositions - Optional array of already-used position ranges to exclude
 * @returns Non-overlapping subset of matches
 */
export function selectNonOverlappingMatches(
  matches: PositionedValueMatch[],
  excludedPositions?: Array<{ start: number; end: number }>
): PositionedValueMatch[] {
  if (matches.length === 0) return [];

  // Sort by score descending (greedy: pick highest first)
  const sorted = [...matches].sort((a, b) => b.score - a.score);

  const selected: PositionedValueMatch[] = [];
  const usedPositions: Array<{ start: number; end: number }> = excludedPositions
    ? [...excludedPositions]
    : [];

  for (const match of sorted) {
    const { inputStart, inputEnd } = match.ngram;

    // Check if this match overlaps with any already selected
    const overlaps = usedPositions.some(
      (pos) => !(inputEnd <= pos.start || inputStart >= pos.end)
    );

    if (!overlaps) {
      selected.push(match);
      usedPositions.push({ start: inputStart, end: inputEnd });
    }
  }

  return selected;
}

/**
 * Converts a primitive value to a HypothesisValueType.
 * Unified helper to avoid repeated inline definitions.
 *
 * @param val - The value to convert (string, number, Date, or boolean)
 * @param parsed - Optional parsed date info to preserve original text (e.g., "gestern")
 * @returns A HypothesisValueType representing the value
 */
export function toHypothesisValue(val: unknown, parsed?: ParsedDate): HypothesisValueType {
  if (typeof val === "number") {
    return { kind: "number", value: val };
  }
  if (val instanceof Date) {
    // If we have parsed date info with original text, use it; otherwise fall back to ISO string
    const dateText = parsed?.text ?? val.toISOString();
    return {
      kind: "date",
      value: val,
      parsed: parsed ?? {
        text: dateText,
        date: val,
        isRange: false,
        consumedText: dateText,
      },
    };
  }
  if (typeof val === "boolean") {
    return { kind: "boolean", value: val };
  }
  return { kind: "string", value: String(val) };
}

/**
 * Creates a HypothesisValueType from a string value, converting to the appropriate
 * type based on the column's data type.
 *
 * @param value - The string value to convert
 * @param columnType - The column's data type (number, date, boolean, string, enum)
 * @returns A properly typed HypothesisValueType
 */
export function createTypedValue(
  value: string,
  columnType: string | undefined
): HypothesisValueType {
  // For number columns, try to parse as number
  if (columnType === "number") {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return { kind: "number", value: num };
    }
  }
  
  // For boolean columns, try to parse as boolean
  if (columnType === "boolean") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "1") {
      return { kind: "boolean", value: true };
    }
    if (lower === "false" || lower === "no" || lower === "0") {
      return { kind: "boolean", value: false };
    }
  }
  
  // Default to string
  return { kind: "string", value };
}
