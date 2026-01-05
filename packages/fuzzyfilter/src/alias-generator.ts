/**
 * Alias Generator
 * 
 * Generates combinatorial aliases from word sets and patterns.
 * This eliminates the need to manually enumerate all variations
 * like "less than or equal", "smaller eq", "less or equals", etc.
 * 
 * @module fuzzyfilter/alias-generator
 */

import type { AliasPattern, SpreadPattern } from "./types/index.ts";
import { WORD_SETS, type WordSetKey } from "./operators.ts";
import type { I18nProvider } from "./types/i18n.ts";
import { createDefaultEnglishProvider } from "./i18n/default-provider.ts";

/**
 * Parsed part from an alias pattern.
 * Contains the word set key and whether it's optional.
 */
interface ParsedPart {
  /** The word set key (without the ? suffix) */
  key: string;
  /** Whether this part is optional (had ? suffix) */
  optional: boolean;
}

/**
 * Parses a part string into its key and optional flag.
 * 
 * @param part - The part string, e.g. "than" or "than?"
 * @returns ParsedPart with key and optional flag
 */
function parsePart(part: string): ParsedPart {
  const optional = part.endsWith("?");
  const key = optional ? part.slice(0, -1) : part;
  return { key, optional };
}

/**
 * Gets all words for a word set key.
 * Returns empty array if the key is not found in WORD_SETS.
 * 
 * @param key - The word set key
 * @param i18nProvider - Optional i18n provider for translations. If not provided, uses default English.
 * @returns Array of words for this key
 */
function getWords(key: string, i18nProvider?: I18nProvider): readonly string[] {
  if (key in WORD_SETS) {
    const wordSetKey = key as WordSetKey;
    if (i18nProvider) {
      return i18nProvider.getWordSet(wordSetKey);
    }
    return WORD_SETS[wordSetKey];
  }
  // If not in word sets, treat the key itself as a literal word
  return [key];
}

/**
 * Generates all combinations of parts, respecting optional parts.
 * 
 * For a pattern like ["less", "than?", "or?", "equal"]:
 * - "than?" and "or?" are optional
 * - We generate all 2^n combinations where n is the number of optional parts
 * 
 * @param parts - Array of parsed parts
 * @returns Array of part combinations (each combination is an array of required keys)
 */
function generatePartCombinations(parts: ParsedPart[]): string[][] {
  const optionalIndices = parts
    .map((p, i) => (p.optional ? i : -1))
    .filter((i) => i !== -1);
  
  const combinations: string[][] = [];
  const numOptional = optionalIndices.length;
  
  // Generate all 2^n combinations of optional parts
  for (let mask = 0; mask < (1 << numOptional); mask++) {
    const combination: string[] = [];
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      
      if (part.optional) {
        // Check if this optional part is included in this combination
        const optionalIndex = optionalIndices.indexOf(i);
        const included = (mask & (1 << optionalIndex)) !== 0;
        if (included) {
          combination.push(part.key);
        }
      } else {
        // Required part - always include
        combination.push(part.key);
      }
    }
    
    combinations.push(combination);
  }
  
  return combinations;
}

/**
 * Generates all word combinations for a sequence of word set keys.
 * 
 * For keys ["less", "equal"], generates:
 * - "less equal"
 * - "less equals"
 * - "less eq"
 * - "smaller equal"
 * - ... all combinations
 * 
 * @param keys - Array of word set keys
 * @param i18nProvider - Optional i18n provider for translations. If not provided, uses default English.
 * @returns Array of joined phrase strings
 */
function expandWordCombinations(keys: string[], i18nProvider?: I18nProvider): string[] {
  if (keys.length === 0) {
    return [];
  }
  
  // Get all word arrays
  const wordArrays = keys.map((key) => getWords(key, i18nProvider));
  
  // Generate cartesian product
  const results: string[] = [];
  
  function generate(index: number, current: string[]): void {
    if (index === wordArrays.length) {
      results.push(current.join(" "));
      return;
    }
    
    const words = wordArrays[index]!;
    for (const word of words) {
      generate(index + 1, [...current, word]);
    }
  }
  
  generate(0, []);
  return results;
}

/**
 * Expands a single alias pattern into all possible aliases.
 * 
 * @param pattern - The alias pattern to expand
 * @param i18nProvider - Optional i18n provider for translations. If not provided, uses default English.
 * @returns Array of generated alias strings
 * 
 * @example
 * ```typescript
 * expandPattern({ parts: ["less", "than?", "or?", "equal"] })
 * // Returns: ["less equal", "less than equal", "less or equal", 
 * //           "less than or equal", "smaller equal", ...]
 * ```
 */
export function expandPattern(pattern: AliasPattern, i18nProvider?: I18nProvider): string[] {
  const parsedParts = pattern.parts.map((p) => parsePart(p as string));
  const partCombinations = generatePartCombinations(parsedParts);
  
  const allAliases: string[] = [];
  
  for (const keys of partCombinations) {
    const aliases = expandWordCombinations(keys, i18nProvider);
    allAliases.push(...aliases);
  }
  
  return allAliases;
}

/**
 * Expands all alias patterns for an operator into a flat array of aliases.
 * 
 * @param patterns - Array of alias patterns
 * @param i18nProvider - Optional i18n provider for translations. If not provided, uses default English.
 * @returns Array of all generated alias strings (deduplicated)
 */
export function expandAliasPatterns(patterns: readonly AliasPattern[], i18nProvider?: I18nProvider): string[] {
  const allAliases = new Set<string>();
  
  for (const pattern of patterns) {
    const expanded = expandPattern(pattern, i18nProvider);
    for (const alias of expanded) {
      allAliases.add(alias);
    }
  }
  
  return Array.from(allAliases);
}

/**
 * Expands a spread pattern into all possible keyword pairs.
 * 
 * For a pattern with keywordSets ["from", "to"], generates pairs like:
 * - ["from", "to"]
 * - ["from", "till"]
 * - ["from", "until"]
 * 
 * @param pattern - The spread pattern to expand
 * @param i18nProvider - Optional i18n provider for translations. If not provided, uses default English.
 * @returns Array of keyword pairs
 */
export function expandSpreadPattern(pattern: SpreadPattern, i18nProvider?: I18nProvider): [string, string][] {
  const startWords = getWords(pattern.keywordSets[0] as string, i18nProvider);
  const endWords = getWords(pattern.keywordSets[1] as string, i18nProvider);
  
  const pairs: [string, string][] = [];
  
  for (const start of startWords) {
    for (const end of endWords) {
      pairs.push([start, end]);
    }
  }
  
  return pairs;
}

/**
 * Gets all expanded keyword pairs from an array of spread patterns.
 * 
 * @param patterns - Array of spread patterns
 * @param i18nProvider - Optional i18n provider for translations. If not provided, uses default English.
 * @returns Array of all keyword pairs
 */
export function getAllSpreadKeywordPairs(
  patterns: readonly SpreadPattern[],
  i18nProvider?: I18nProvider
): [string, string][] {
  const pairs: [string, string][] = [];
  
  for (const pattern of patterns) {
    pairs.push(...expandSpreadPattern(pattern, i18nProvider));
  }
  
  return pairs;
}

/**
 * Gets all possible starting keywords from spread patterns.
 * Useful for detecting when a user might be starting a spread pattern.
 * 
 * @param patterns - Array of spread patterns
 * @param i18nProvider - Optional i18n provider for translations. If not provided, uses default English.
 * @returns Set of all starting keywords
 */
export function getSpreadStartKeywords(
  patterns: readonly SpreadPattern[],
  i18nProvider?: I18nProvider
): Set<string> {
  const keywords = new Set<string>();
  
  for (const pattern of patterns) {
    const words = getWords(pattern.keywordSets[0] as string, i18nProvider);
    for (const word of words) {
      keywords.add(word.toLowerCase());
    }
  }
  
  return keywords;
}

/**
 * Gets all possible separator keywords from spread patterns.
 * Useful for detecting the middle of a spread pattern.
 * 
 * @param patterns - Array of spread patterns
 * @param i18nProvider - Optional i18n provider for translations. If not provided, uses default English.
 * @returns Set of all separator keywords
 */
export function getSpreadSeparatorKeywords(
  patterns: readonly SpreadPattern[],
  i18nProvider?: I18nProvider
): Set<string> {
  const keywords = new Set<string>();
  
  for (const pattern of patterns) {
    const words = getWords(pattern.keywordSets[1] as string, i18nProvider);
    for (const word of words) {
      keywords.add(word.toLowerCase());
    }
  }
  
  return keywords;
}
