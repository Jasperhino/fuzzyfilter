/**
 * i18n Library Adapters for FuzzyFilter
 * 
 * Provides adapters for popular i18n libraries like i18next and vue-i18n.
 * 
 * @module fuzzyfilter/i18n/adapters
 */

import type { I18nProvider } from "../types/i18n.ts";
import type { OperatorKey } from "../operators.ts";
import { getOperator } from "../operators.ts";

/**
 * Flatten the aliases object from a pattern-based operator into an array.
 */
function flattenOperatorAliases(operatorId: OperatorKey): string[] {
  const op = getOperator(operatorId);
  if (!op?.aliases) return [];
  
  const result: string[] = [];
  for (const values of Object.values(op.aliases)) {
    for (const val of values) {
      // Skip i18n refs (they get resolved dynamically)
      if (!val.startsWith("$")) {
        result.push(val);
      }
    }
  }
  return result;
}

/**
 * Options for i18next adapter
 */
export interface I18nextAdapterOptions {
  /** Namespace for translation keys. Default: "fuzzyfilter" */
  namespace?: string;
  /** Key prefix for nested keys. Default: "" */
  keyPrefix?: string;
}

/**
 * Creates an I18nProvider adapter for i18next.
 * 
 * Translation key structure:
 * ```
 * fuzzyfilter:
 *   operators:
 *     eq:
 *       label: "equals"
 *       aliases: ["equal", "=", "=="]
 * ```
 * 
 * @param i18n - The i18next instance
 * @param options - Optional configuration
 * @returns I18nProvider implementation
 * 
 * @example
 * ```typescript
 * import i18n from 'i18next';
 * import { createI18nextAdapter } from 'fuzzyfilter/i18n';
 * 
 * const filter = createFuzzyFilter({
 *   i18nProvider: createI18nextAdapter(i18n)
 * });
 * ```
 */
export function createI18nextAdapter(
  i18n: {
    t: (key: string, options?: {
      ns?: string;
      returnObjects?: boolean;
      defaultValue?: unknown;
    }) => unknown;
    on: (event: string, callback: () => void) => void;
    off: (event: string, callback: () => void) => void;
  },
  options?: I18nextAdapterOptions
): I18nProvider {
  const namespace = options?.namespace ?? "fuzzyfilter";
  const prefix = options?.keyPrefix ?? "";
  
  return {
    getOperatorLabel(operatorId: OperatorKey): string {
      const op = getOperator(operatorId);
      const defaultValue = op?.id ?? operatorId;
      const result = i18n.t(`${prefix}operators.${operatorId}.label`, {
        ns: namespace,
        defaultValue,
      });
      return typeof result === "string" ? result : defaultValue;
    },

    getOperatorAliases(operatorId: OperatorKey): string[] {
      const defaultValue = flattenOperatorAliases(operatorId);
      const result = i18n.t(`${prefix}operators.${operatorId}.aliases`, {
        ns: namespace,
        returnObjects: true,
        defaultValue,
      });
      if (Array.isArray(result)) {
        return result.map(String);
      }
      if (typeof result === "string") {
        return [result];
      }
      return defaultValue;
    },

    onChange(callback: () => void): () => void {
      i18n.on("languageChanged", callback);
      return () => i18n.off("languageChanged", callback);
    },
  };
}

/**
 * Options for Vue-i18n adapter
 */
export interface VueI18nAdapterOptions {
  /** Key prefix for nested keys. Default: "fuzzyfilter" */
  keyPrefix?: string;
}

/**
 * Creates an I18nProvider adapter for vue-i18n.
 * 
 * Translation key structure (same as i18next):
 * ```
 * fuzzyfilter:
 *   operators:
 *     eq:
 *       label: "equals"
 *       aliases: ["equal", "="]
 * ```
 * 
 * @param i18n - The vue-i18n Composer or VueI18n instance
 * @param options - Optional configuration
 * @returns I18nProvider implementation
 * 
 * @example
 * ```typescript
 * import { createI18n } from 'vue-i18n';
 * import { createVueI18nAdapter } from 'fuzzyfilter/i18n';
 * 
 * const i18n = createI18n({ ... });
 * const filter = createFuzzyFilter({
 *   i18nProvider: createVueI18nAdapter(i18n.global)
 * });
 * ```
 */
export function createVueI18nAdapter(
  i18n: {
    t: (key: string, defaultValue?: string) => unknown;
  } | {
    t: (key: string, defaultValue?: string) => unknown;
  },
  options?: VueI18nAdapterOptions
): I18nProvider {
  const prefix = options?.keyPrefix ?? "fuzzyfilter";
  
  // Handle both Composer and VueI18n instances
  const t = typeof i18n.t === "function" 
    ? i18n.t.bind(i18n)
    : (key: string, defaultValue?: string) => {
        // Fallback for older vue-i18n API
        return (i18n as any).t(`${prefix}.${key}`, defaultValue ?? "");
      };
  
  return {
    getOperatorLabel(operatorId: OperatorKey): string {
      const op = getOperator(operatorId);
      const defaultValue = op?.id ?? operatorId;
      const result = t(`operators.${operatorId}.label`, defaultValue);
      return typeof result === "string" ? result : defaultValue;
    },

    getOperatorAliases(operatorId: OperatorKey): string[] {
      const defaultAliases = flattenOperatorAliases(operatorId);
      const defaultValue = defaultAliases.join(",");
      const result = t(`operators.${operatorId}.aliases`, defaultValue);
      if (Array.isArray(result)) {
        return result.map(String);
      }
      if (typeof result === "string") {
        // Handle comma-separated string
        return result.split(",").map(s => s.trim()).filter(Boolean);
      }
      return defaultAliases;
    },
  };
}
