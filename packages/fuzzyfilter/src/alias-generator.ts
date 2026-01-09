/**
 * Alias Generator
 * 
 * Generates combinatorial aliases from word sets and patterns.
 * This eliminates the need to manually enumerate all variations
 * like "less than or equal", "smaller eq", "less or equals", etc.
 * 
 * @module fuzzyfilter/alias-generator
 */

import type { I18nProvider } from "./types/i18n.ts";

/**
 * Alias Generator
 * 
 * This file is now minimal - template pattern extraction is handled
 * by the pattern compiler. These functions are kept for backward
 * compatibility but are no longer used.
 */

import type { I18nProvider } from "./types/i18n.ts";

/**
 * Gets all possible starting keywords from template patterns.
 * Useful for detecting when a user might be starting a templated operator.
 * 
 * @param patterns - Array of template patterns (deprecated - no longer used)
 * @param i18nProvider - Optional i18n provider for translations
 * @returns Set of all starting keywords
 * @deprecated Template patterns are no longer used - pattern compiler handles this
 */
export function getTemplateStartKeywords(
  _patterns: readonly unknown[],
  _i18nProvider?: I18nProvider
): Set<string> {
  // This function is kept for backward compatibility but returns empty set
  // Template pattern detection is now handled by the pattern compiler
  return new Set<string>();
}

/**
 * Gets all possible separator keywords from template patterns.
 * Useful for detecting the middle of a templated operator.
 * 
 * @param patterns - Array of template patterns (deprecated - no longer used)
 * @param i18nProvider - Optional i18n provider for translations
 * @returns Set of all separator keywords
 * @deprecated Template patterns are no longer used - pattern compiler handles this
 */
export function getTemplateSeparatorKeywords(
  _patterns: readonly unknown[],
  _i18nProvider?: I18nProvider
): Set<string> {
  // This function is kept for backward compatibility but returns empty set
  // Template pattern detection is now handled by the pattern compiler
  return new Set<string>();
}
