/**
 * i18n Types for FuzzyFilter
 * 
 * Defines interfaces for internationalization support, allowing translation
 * of operator labels, aliases, and word sets.
 * 
 * @module fuzzyfilter/types/i18n
 */

import type { Operator, OperatorInfo } from "../operators.ts";
import type { DataType } from "./core.ts";
import type { WordSetKey } from "../operators.ts";

// ============================================================================
// I18N PROVIDER INTERFACE
// ============================================================================

/**
 * Provider interface for integrating with i18n libraries.
 * 
 * Allows FuzzyFilter to extract translations from external i18n systems
 * like i18next, vue-i18n, etc.
 * 
 * The default English provider implements this interface using hardcoded
 * values from the OPERATORS registry and WORD_SETS.
 */
export interface I18nProvider {
  /**
   * Get the translated label for an operator.
   * 
   * @param operatorId - The operator ID (e.g., "eq", "contains")
   * @returns Translated label (e.g., "igual" for Spanish "eq")
   */
  getOperatorLabel(operatorId: Operator): string;
  
  /**
   * Get all translated aliases for an operator.
   * 
   * @param operatorId - The operator ID
   * @returns Array of translated aliases for fuzzy matching
   */
  getOperatorAliases(operatorId: Operator): string[];
  
  /**
   * Get translated words for a word set.
   * 
   * Used for expanding alias patterns and spread patterns.
   * 
   * @param wordSetKey - The word set key (e.g., "less", "greater", "from")
   * @returns Array of translated words
   */
  getWordSet(wordSetKey: WordSetKey): string[];
  
  /**
   * Optional: Subscribe to language change events.
   * 
   * If provided, FuzzyFilter can reactively update when language changes.
   * Should return an unsubscribe function.
   * 
   * @param callback - Function to call when language changes
   * @returns Unsubscribe function
   */
  onChange?: (callback: () => void) => () => void;
}

// ============================================================================
// TRANSLATION OBJECT TYPES
// ============================================================================

/**
 * Translation for a single operator
 */
export interface OperatorTranslation {
  /** Display label shown in UI suggestions */
  label: string;
  /** Searchable aliases for fuzzy matching */
  aliases: string[];
  /** Optional: Type-specific aliases (e.g., "at" for date equality) */
  typeSpecificAliases?: Partial<Record<DataType, string[]>>;
}

/**
 * Complete translations for all operators
 */
export type OperatorTranslations = Partial<Record<Operator, OperatorTranslation>>;

/**
 * Translations for word sets (used in alias patterns and spread patterns)
 */
export type WordSetTranslations = Partial<Record<WordSetKey, string[]>>;

/**
 * Complete translation object
 * 
 * Used by `createObjectProvider()` to create an I18nProvider from a plain object.
 */
export interface FuzzyFilterTranslations {
  operators?: OperatorTranslations;
  wordSets?: WordSetTranslations;
}
