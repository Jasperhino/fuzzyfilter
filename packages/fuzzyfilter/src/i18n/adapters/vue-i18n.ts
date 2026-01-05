/**
 * vue-i18n adapter for FuzzyFilter
 * 
 * This adapter allows FuzzyFilter to work with vue-i18n for translations.
 * 
 * @example
 * ```typescript
 * import { createI18n } from "vue-i18n";
 * import { createVueI18nProvider } from "fuzzyfilter/i18n/adapters/vue-i18n";
 * import { createFuzzyFilter } from "fuzzyfilter";
 * 
 * // Initialize vue-i18n
 * const i18n = createI18n({
 *   locale: "en",
 *   messages: {
 *     en: { fuzzyfilter: { ... } },
 *     es: { fuzzyfilter: { ... } },
 *   },
 * });
 * 
 * // Create provider
 * const provider = createVueI18nProvider(i18n, "fuzzyfilter");
 * 
 * // Use with FuzzyFilter
 * const filter = createFuzzyFilter({
 *   i18nProvider: provider,
 * });
 * ```
 */

import type { I18nProvider } from "../../types/i18n.ts";
import type { Operator, WordSetKey } from "../../operators.ts";
import type { I18n } from "vue-i18n";

/**
 * Creates an I18nProvider that uses vue-i18n for translations.
 * 
 * @param i18nInstance - The vue-i18n instance
 * @param namespace - Optional namespace prefix for translation keys (default: "fuzzyfilter")
 * @returns An I18nProvider instance
 */
export function createVueI18nProvider(
  i18nInstance: I18n,
  namespace = "fuzzyfilter"
): I18nProvider {
  const getKey = (key: string): string => {
    return namespace ? `${namespace}.${key}` : key;
  };

  /**
   * Get the current locale value, handling both legacy and composition API modes
   */
  const getCurrentLocale = (): string => {
    const locale = i18nInstance.global.locale;
    // In legacy mode, locale is a string; in composition mode, it's a Ref
    return typeof locale === "string" ? locale : locale.value;
  };

  /**
   * Get raw message (preserving arrays/objects) using tm() instead of t()
   * t() always returns strings, tm() returns the raw message structure
   */
  const getRawMessage = (key: string): unknown => {
    try {
      // Use tm() to get the raw message structure (arrays are preserved)
      return i18nInstance.global.tm(key);
    } catch {
      return undefined;
    }
  };

  return {
    getOperatorLabel: (operatorId: Operator): string => {
      const key = getKey(`operators.${operatorId}.label`);
      try {
        const translated = i18nInstance.global.t(key);
        // If translation returns the key itself, it means translation not found
        return translated !== key ? String(translated) : operatorId;
      } catch {
        // Fallback to operator ID if translation not found
        return operatorId;
      }
    },

    getOperatorAliases: (operatorId: Operator): string[] => {
      const key = getKey(`operators.${operatorId}.aliases`);
      const translated = getRawMessage(key);
      
      // If translation returns an array, use it
      if (Array.isArray(translated) && translated.length > 0) {
        return translated.map(String);
      }
      
      // Fallback to empty array if translation not found
      return [];
    },

    getWordSet: (wordSetKey: WordSetKey): string[] => {
      const key = getKey(`wordSets.${wordSetKey}`);
      const translated = getRawMessage(key);
      
      // If translation returns an array, use it
      if (Array.isArray(translated) && translated.length > 0) {
        return translated.map(String);
      }
      
      // Fallback to empty array if translation not found
      return [];
    },

    translate: (key: string): string | undefined => {
      // Use the app namespace for column/value translations
      const appKey = `app.${key}`;
      try {
        const translated = i18nInstance.global.t(appKey);
        // If translation returns the key itself, it means translation not found
        if (translated === appKey) {
          return undefined;
        }
        return String(translated);
      } catch {
        return undefined;
      }
    },

    onChange: (callback: () => void): (() => void) => {
      // For vue-i18n, we watch the locale reactive value
      // Since we can't import Vue here (it's a peer dependency), we use polling
      // This is acceptable as language changes are infrequent
      let lastLocale = getCurrentLocale();
      const interval = setInterval(() => {
        const currentLocale = getCurrentLocale();
        if (currentLocale !== lastLocale) {
          lastLocale = currentLocale;
          callback();
        }
      }, 100);
      
      return () => {
        clearInterval(interval);
      };
    },
  };
}
