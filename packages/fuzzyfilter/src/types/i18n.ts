/**
 * i18n Types for FuzzyFilter
 * 
 * Defines interfaces for internationalization support, allowing translation
 * of operator labels, aliases, and word sets.
 * 
 * @module fuzzyfilter/types/i18n
 */

import type { OperatorKey } from "../operators.ts";
import type { DataType } from "./core.ts";

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
 * values from the OPERATORS registry.
 */
export interface I18nProvider {
  /**
   * Get all aliases for matching user input (always returns array).
   * 
   * Used for enum values, operator aliases, and any other i18n keys that
   * have multiple possible translations/aliases.
   * 
   * @param key - The i18n key (e.g., "operators.eq", "status.active")
   * @returns Array of aliases (always returns array, never undefined)
   * 
   * @example
   * ```typescript
   * getAliases('operators.eq') // → ['is', 'equals', '=']
   * getAliases('status.active') // → ['active', 'enabled', 'on']
   * ```
   */
  getAliases(key: string): string[];
  
  /**
   * Get primary display label for suggestions.
   * 
   * Returns the first/primary translation for display purposes.
   * 
   * @param key - The i18n key (e.g., "columns.status", "operators.eq")
   * @returns Primary display label (string)
   * 
   * @example
   * ```typescript
   * getLabel('columns.status') // → 'Status'
   * getLabel('operators.eq') // → 'is' (first alias)
   * ```
   */
  getLabel(key: string): string;
  
  /**
   * Current locale.
   * 
   * Used for locale-specific features like date parsing.
   */
  readonly locale: string;
  
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
export type OperatorTranslations = Partial<Record<OperatorKey, OperatorTranslation>>;


/**
 * Complete translation object
 * 
 * Used by `createObjectProvider()` to create an I18nProvider from a plain object.
 * Can be used with `@fuzzyfilter/i18n-locales` package for pre-built translations.
 * 
 * Translations are resolved via the `translate()` method of I18nProvider:
 * - `t(operators.eq)` → `translate("operators.eq")` → returns aliases array
 * - `t(between)` → `translate("between")` → returns translated word
 * 
 * @example
 * ```typescript
 * import { en, es } from "@fuzzyfilter/i18n-locales";
 * import { createObjectProvider } from "fuzzyfilter";
 * 
 * const provider = createObjectProvider(en);
 * ```
 */
export interface FuzzyFilterTranslations {
  /** Operator-specific translations (labels and aliases) */
  operators?: OperatorTranslations;
}
