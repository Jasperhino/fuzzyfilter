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
import type { Operator } from "../operators.ts";
import type { WordSetKey } from "../operators.ts";
import { getOperator } from "../operators.ts";
import { WORD_SETS } from "../operators.ts";
import { createDefaultEnglishProvider } from "./default-provider.ts";

/**
 * Creates an I18nProvider from a translation object.
 * 
 * Missing translations fall back to English defaults from the OPERATORS
 * registry and WORD_SETS.
 * 
 * @param translations - Translation object with operators and word sets
 * @returns I18nProvider implementation
 * 
 * @example
 * ```typescript
 * const provider = createObjectProvider({
 *   operators: {
 *     eq: { label: "igual", aliases: ["=", "=="] }
 *   },
 *   wordSets: {
 *     less: ["menor", "más pequeño"]
 *   }
 * });
 * ```
 */
export function createObjectProvider(translations: FuzzyFilterTranslations): I18nProvider {
  const defaultProvider = createDefaultEnglishProvider();
  
  return {
    getOperatorLabel(operatorId: Operator): string {
      const translation = translations.operators?.[operatorId];
      if (translation?.label) {
        return translation.label;
      }
      return defaultProvider.getOperatorLabel(operatorId);
    },

    getOperatorAliases(operatorId: Operator): string[] {
      const translation = translations.operators?.[operatorId];
      if (translation?.aliases && translation.aliases.length > 0) {
        return [...translation.aliases];
      }
      return defaultProvider.getOperatorAliases(operatorId);
    },

    getWordSet(wordSetKey: WordSetKey): string[] {
      const translation = translations.wordSets?.[wordSetKey];
      if (translation && translation.length > 0) {
        return [...translation];
      }
      return defaultProvider.getWordSet(wordSetKey);
    },
  };
}
