/**
 * Default English I18nProvider
 * 
 * Provides English translations using hardcoded values from OPERATORS registry
 * and WORD_SETS. This is the default provider used when no custom provider
 * is specified.
 * 
 * @module fuzzyfilter/i18n/default-provider
 */

import type { I18nProvider } from "../types/i18n.ts";
import type { Operator } from "../operators.ts";
import type { WordSetKey } from "../operators.ts";
import { getAllOperators, getOperator } from "../operators.ts";
import { WORD_SETS } from "../operators.ts";

/**
 * Creates the default English I18nProvider implementation.
 * 
 * This provider uses the hardcoded English values from the OPERATORS registry
 * and WORD_SETS. It does not support language changes (no onChange callback).
 * 
 * @returns I18nProvider implementation for English
 */
export function createDefaultEnglishProvider(): I18nProvider {
  return {
    getOperatorLabel(operatorId: Operator): string {
      const op = getOperator(operatorId);
      return op.label;
    },

    getOperatorAliases(operatorId: Operator): string[] {
      const op = getOperator(operatorId);
      return [...op.aliases];
    },

    getWordSet(wordSetKey: WordSetKey): string[] {
      return [...WORD_SETS[wordSetKey]];
    },

    getLocale(): string {
      return "en";
    },

    // No onChange callback - English translations are static
  };
}
