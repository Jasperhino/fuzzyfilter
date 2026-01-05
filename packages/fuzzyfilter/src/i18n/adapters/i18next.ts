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
import type { Operator, WordSetKey } from "../../operators.ts";
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
    getOperatorLabel: (operatorId: Operator): string => {
      const key = getKey(`operators.${operatorId}.label`);
      const translated = i18nInstance.t(key, { defaultValue: undefined });
      // Fallback to operator ID if translation not found
      return translated !== key ? translated : operatorId;
    },

    getOperatorAliases: (operatorId: Operator): string[] => {
      const key = getKey(`operators.${operatorId}.aliases`);
      const translated = i18nInstance.t(key, { defaultValue: undefined, returnObjects: true });
      
      // If translation returns an array, use it
      if (Array.isArray(translated) && translated.length > 0) {
        return translated;
      }
      
      // Fallback to empty array if translation not found
      return [];
    },

    getWordSet: (wordSetKey: WordSetKey): string[] => {
      const key = getKey(`wordSets.${wordSetKey}`);
      const translated = i18nInstance.t(key, { defaultValue: undefined, returnObjects: true });
      
      // If translation returns an array, use it
      if (Array.isArray(translated) && translated.length > 0) {
        return translated;
      }
      
      // Fallback to empty array if translation not found
      return [];
    },

    translate: (key: string): string | undefined => {
      // Use the app namespace for column/value translations
      const appKey = `app:${key}`;
      const translated = i18nInstance.t(appKey, { defaultValue: undefined });
      
      // If translation returns the key itself, it means translation not found
      if (translated === appKey || translated === undefined) {
        return undefined;
      }
      
      return String(translated);
    },

    getLocale: (): string | undefined => {
      return i18nInstance.language;
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
