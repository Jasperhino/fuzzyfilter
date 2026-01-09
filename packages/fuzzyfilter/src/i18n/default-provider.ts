/**
 * Default English I18nProvider
 * 
 * Provides English translations using hardcoded values from OPERATORS registry.
 * This is the default provider used when no custom provider is specified.
 * 
 * @module fuzzyfilter/i18n/default-provider
 */

import type { I18nProvider } from "../types/i18n.ts";
import type { OperatorKey } from "../operators.ts";
import { getOperator } from "../operators.ts";

/**
 * Flatten the aliases object from a pattern-based operator into an array.
 */
function flattenAliases(aliases: Record<string, readonly string[]> | undefined): string[] {
  if (!aliases) return [];
  const result: string[] = [];
  for (const values of Object.values(aliases)) {
    for (const val of values) {
      // Skip i18n refs (t(key)) - they get resolved dynamically
      if (!val.startsWith("t(")) {
        // Convert underscores to spaces
        result.push(val.replace(/_/g, " "));
      }
    }
  }
  return result;
}

/**
 * Default English translations for operators.
 * Used when t(operators.xxx) is called.
 */
const DEFAULT_OPERATOR_ALIASES: Record<string, string[]> = {
  eq: ["equal", "equals", "is"],
  neq: ["not equals", "not equal", "is not", "isn't", "doesn't equal", "does not equal"],
  eqIgnoreCase: ["equals ignore case", "equal ignore case"],
  neqIgnoreCase: ["not equals ignore case", "not equal ignore case"],
  lt: ["less than", "smaller than", "lower than"],
  lte: ["less than or equal", "at most", "no more than"],
  gt: ["greater than", "bigger than", "larger than", "more than"],
  gte: ["greater than or equal", "at least", "no less than"],
  in: ["one of", "any of"],
  nin: ["not in", "not one of", "none of"],
  contains: ["contains", "has", "includes"],
  notContains: ["does not contain", "doesn't contain", "not contains"],
  startsWith: ["starts with", "begins with"],
  endsWith: ["ends with"],
  isEmpty: ["is empty", "is blank", "is null", "is missing"],
  isNotEmpty: ["is not empty", "is not blank", "has value"],
  isTrue: ["is true", "is yes", "is on", "is enabled", "is active"],
  isFalse: ["is false", "is no", "is off", "is disabled", "is inactive"],
  before: ["before", "earlier than", "prior to"],
  after: ["after", "later than", "since"],
  between: ["between", "in range", "within"],
};

/**
 * Default English translations for words used in patterns.
 * Used when t(between), t(from), t(and), etc. is called.
 */
const DEFAULT_WORD_TRANSLATIONS: Record<string, string> = {
  between: "between",
  from: "from",
  to: "to",
  and: "and",
  or: "or",
  not: "not",
  is: "is",
  equals: "equals",
  equal: "equal",
  less: "less",
  greater: "greater",
  than: "than",
  contains: "contains",
  starts: "starts",
  ends: "ends",
  with: "with",
  empty: "empty",
  true: "true",
  false: "false",
};

/**
 * Creates the default English I18nProvider implementation.
 * 
 * This provider uses the hardcoded English values from the OPERATORS registry.
 * It does not support language changes (no onChange callback).
 * 
 * @returns I18nProvider implementation for English
 */
export function createDefaultEnglishProvider(): I18nProvider {
  return {
    locale: "en",

    /**
     * Get all aliases for a key (always returns array).
     * 
     * Supports:
     * - "operators.eq" -> returns array of aliases for eq operator
     * - "columns.status" -> returns array with single label (fallback)
     * - "status.active" -> returns array with single label (fallback)
     * - Simple words -> returns array with single translation
     */
    getAliases(key: string): string[] {
      // Handle operators.xxx format
      if (key.startsWith("operators.")) {
        const opId = key.slice("operators.".length);
        const aliases = DEFAULT_OPERATOR_ALIASES[opId];
        if (aliases) return aliases;
      }
      
      // Handle simple word translations
      if (key in DEFAULT_WORD_TRANSLATIONS) {
        return [DEFAULT_WORD_TRANSLATIONS[key]];
      }
      
      // For other keys (columns.xxx, xxx.yyy), try to extract a label
      // Fallback: return the key itself as a single-item array
      const label = this.getLabel(key);
      return [label];
    },

    /**
     * Get primary display label for a key.
     * 
     * Returns the first alias or the key itself as fallback.
     */
    getLabel(key: string): string {
      // Handle operators.xxx format
      if (key.startsWith("operators.")) {
        const opId = key.slice("operators.".length);
        const aliases = DEFAULT_OPERATOR_ALIASES[opId];
        if (aliases && aliases.length > 0) {
          return aliases[0];
        }
        // Fallback to operator id
        const op = getOperator(opId as OperatorKey);
        return op?.id ?? opId;
      }
      
      // Handle simple word translations
      if (key in DEFAULT_WORD_TRANSLATIONS) {
        return DEFAULT_WORD_TRANSLATIONS[key];
      }
      
      // For other keys (columns.xxx, xxx.yyy), extract the last part as label
      // e.g., "columns.status" -> "status", "status.active" -> "active"
      const parts = key.split(".");
      return parts[parts.length - 1] ?? key;
    },

    // Legacy methods for backward compatibility
    getOperatorLabel(operatorId: OperatorKey): string {
      return this.getLabel(`operators.${operatorId}`);
    },

    getOperatorAliases(operatorId: OperatorKey): string[] {
      return this.getAliases(`operators.${operatorId}`);
    },

    getLocale(): string {
      return this.locale;
    },

    /**
     * Translate a key. Supports:
     * - "operators.eq" -> returns array of aliases for eq operator
     * - "between", "from", etc. -> returns single word translation
     * 
     * @deprecated Use getAliases() or getLabel() instead
     */
    translate(key: string): string | string[] | undefined {
      const aliases = this.getAliases(key);
      // Return array if multiple aliases, single string if one alias
      return aliases.length === 1 ? aliases[0] : aliases;
    },

    // No onChange callback - English translations are static
  };
}
