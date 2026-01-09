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
import type { OperatorKey } from "../../operators.ts";
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

  // Cast t function to avoid union type compatibility issues
  const t = i18nInstance.global.t as (key: string) => unknown;

  return {
    get locale(): string {
      return getCurrentLocale();
    },

    /**
     * Get all aliases for a key (always returns array).
     * Supports nested keys like "columns.status", "status.active", etc.
     */
    getAliases(key: string): string[] {
      // Try app namespace first (for user-defined translations)
      const appKey = `app.${key}`;
      try {
        const appTranslated = getRawMessage(appKey);
        
        if (Array.isArray(appTranslated) && appTranslated.length > 0) {
          return appTranslated.map(String);
        }
        
        if (typeof appTranslated === "string") {
          return [appTranslated];
        }
      } catch {
        // Translation not found in app namespace
      }
      
      // Try fuzzyfilter namespace
      const fuzzyKey = getKey(key);
      try {
        const fuzzyTranslated = getRawMessage(fuzzyKey);
        
        if (Array.isArray(fuzzyTranslated) && fuzzyTranslated.length > 0) {
          return fuzzyTranslated.map(String);
        }
        
        if (typeof fuzzyTranslated === "string") {
          return [fuzzyTranslated];
        }
      } catch {
        // Translation not found
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
