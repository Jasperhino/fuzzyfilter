/**
 * i18next adapter for FuzzyFilter
 * 
 * This adapter allows FuzzyFilter to work with i18next for translations.
 * 
 * @example
 * ```typescript
 * import i18n from "i18next";
 * import { createI18nextProvider } from "fuzzyfilter/i18n/adapters/i18next";
 * import { createFuzzyFilter } from "fuzzyfilter";
 * 
 * // Initialize i18next
 * i18n.init({
 *   resources: {
 *     en: { translation: { ... } },
 *     es: { translation: { ... } },
 *   },
 * });
 * 
 * // Create provider
 * const provider = createI18nextProvider(i18n, "fuzzyfilter");
 * 
 * // Use with FuzzyFilter
 * const filter = createFuzzyFilter({
 *   i18nProvider: provider,
 * });
 * ```
 */

import type { I18nProvider } from "../../types/i18n.ts";
import type { OperatorKey } from "../../operators.ts";
import type { i18n as I18nextInstance } from "i18next";

/**
 * Creates an I18nProvider that uses i18next for translations.
 * 
 * @param i18nInstance - The i18next instance
 * @param namespace - Optional namespace prefix for translation keys (default: "fuzzyfilter")
 * @returns An I18nProvider instance
 */
export function createI18nextProvider(
  i18nInstance: I18nextInstance,
  namespace = "fuzzyfilter"
): I18nProvider {
  const getKey = (key: string): string => {
    return namespace ? `${namespace}:${key}` : key;
  };

  return {
    locale: i18nInstance.language,

    /**
     * Get all aliases for a key (always returns array).
     * Supports nested keys like "columns.status", "status.active", etc.
     */
    getAliases(key: string): string[] {
      // Try app namespace first (for user-defined translations)
      const appKey = `app:${key}`;
      const appTranslated = i18nInstance.t(appKey, { defaultValue: undefined, returnObjects: true });
      
      if (Array.isArray(appTranslated) && appTranslated.length > 0) {
        return appTranslated.map(String);
      }
      
      if (typeof appTranslated === "string" && appTranslated !== appKey) {
        return [appTranslated];
      }
      
      // Try fuzzyfilter namespace
      const fuzzyKey = getKey(key);
      const fuzzyTranslated = i18nInstance.t(fuzzyKey, { defaultValue: undefined, returnObjects: true });
      
      if (Array.isArray(fuzzyTranslated) && fuzzyTranslated.length > 0) {
        return fuzzyTranslated.map(String);
      }
      
      if (typeof fuzzyTranslated === "string" && fuzzyTranslated !== fuzzyKey) {
        return [fuzzyTranslated];
      }
      
      // Fallback: return key as single-item array
      const parts = key.split(".");
      return [parts[parts.length - 1] ?? key];
    },

    /**
     * Get primary display label for a key.
     */
    getLabel(key: string): string {
      const aliases = this.getAliases(key);
      return aliases[0] ?? key;
    },

    // Legacy methods for backward compatibility
    getOperatorLabel(operatorId: OperatorKey): string {
      return this.getLabel(`operators.${operatorId}`);
    },

    getOperatorAliases(operatorId: OperatorKey): string[] {
      return this.getAliases(`operators.${operatorId}`);
    },

    translate(key: string): string | string[] | undefined {
      const aliases = this.getAliases(key);
      return aliases.length === 1 ? aliases[0] : aliases;
    },

    getLocale(): string | undefined {
      return this.locale;
    },

    onChange: (callback: () => void): (() => void) => {
      // Subscribe to i18next language change events
      const handler = () => {
        callback();
      };
      
      i18nInstance.on("languageChanged", handler);
      
      // Return unsubscribe function
      return () => {
        i18nInstance.off("languageChanged", handler);
      };
    },
  };
}
