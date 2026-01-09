/**
 * Object Provider for FuzzyFilter Translations
 * 
 * Creates an I18nProvider from a plain translation object.
 * This is a convenience helper for users who want to provide translations
 * as plain objects without using an i18n library.
 * 
 * @module fuzzyfilter/i18n/object-provider
 */

import type { I18nProvider, FuzzyFilterTranslations } from "../types/i18n.ts";
import type { OperatorKey } from "../operators.ts";
import { getOperator } from "../operators.ts";
import { createDefaultEnglishProvider } from "./default-provider.ts";

/**
 * Helper function to get nested value from an object using dot notation.
 */
function getNestedValue(obj: any, key: string): any {
  const parts = key.split(".");
  let value: any = obj;
  for (const part of parts) {
    value = value?.[part];
    if (value === undefined) break;
  }
  return value;
}

/**
 * Creates an I18nProvider from a translation object.
 * 
 * Missing translations fall back to English defaults from the OPERATORS registry.
 * Supports nested keys like "columns.status", "status.active", etc.
 * 
 * @param translations - Translation object with operators, columns, and other keys
 * @param locale - Optional locale code (defaults to "en")
 * @returns I18nProvider implementation
 * 
 * @example
 * ```typescript
 * const provider = createObjectProvider({
 *   operators: {
 *     eq: { label: "igual", aliases: ["=", "=="] }
 *   },
 *   columns: {
 *     status: "Estado"
 *   },
 *   status: {
 *     active: "Activo",
 *     inactive: "Inactivo"
 *   }
 * });
 * ```
 */
export function createObjectProvider(
  translations: FuzzyFilterTranslations & Record<string, any>,
  locale: string = "en"
): I18nProvider {
  const defaultProvider = createDefaultEnglishProvider();
  
  return {
    locale,

    /**
     * Get all aliases for a key (always returns array).
     * 
     * Supports nested keys like "columns.status", "status.active", etc.
     * If the value is an array, returns it directly.
     * If the value is a string, returns it as a single-item array.
     * Falls back to default provider if not found.
     */
    getAliases(key: string): string[] {
      const value = getNestedValue(translations, key);
      
      if (Array.isArray(value)) {
        return value;
      }
      
      if (typeof value === "string") {
        return [value];
      }
      
      // Fallback to default provider
      return defaultProvider.getAliases(key);
    },

    /**
     * Get primary display label for a key.
     * 
     * Returns the first alias if array, the string value if string,
     * or falls back to default provider.
     */
    getLabel(key: string): string {
      const value = getNestedValue(translations, key);
      
      if (Array.isArray(value) && value.length > 0) {
        return value[0];
      }
      
      if (typeof value === "string") {
        return value;
      }
      
      // Fallback to default provider
      return defaultProvider.getLabel(key);
    },
  };
}
