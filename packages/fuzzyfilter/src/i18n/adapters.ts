/**
 * i18n Library Adapters for FuzzyFilter
 * 
 * Provides adapters for popular i18n libraries like i18next and vue-i18n.
 * 
 * @module fuzzyfilter/i18n/adapters
 */

import type { I18nProvider } from "../types/i18n.ts";

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
    language?: string;
  },
  options?: I18nextAdapterOptions
): I18nProvider {
  const namespace = options?.namespace ?? "fuzzyfilter";
  const prefix = options?.keyPrefix ?? "";
  
  return {
    get locale(): string {
      return i18n.language ?? "en";
    },

    getAliases(key: string): string[] {
      // General i18n key lookup
      const result = i18n.t(`${prefix}${key}`, {
        ns: namespace,
        returnObjects: true,
        defaultValue: [],
      });
      if (Array.isArray(result)) {
        return result.map(String);
      }
      if (typeof result === "string" && result) {
        return [result];
      }
      // Fallback: extract last part of key
      const parts = key.split(".");
      return [parts[parts.length - 1] ?? key];
    },

    getLabel(key: string): string {
      // General i18n key lookup
      const parts = key.split(".");
      const defaultValue = parts[parts.length - 1] ?? key;
      const result = i18n.t(`${prefix}${key}`, {
        ns: namespace,
        defaultValue,
      });
      return typeof result === "string" ? result : defaultValue;
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
    locale?: { value?: string } | string;
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
    get locale(): string {
      if (typeof i18n.locale === "string") return i18n.locale;
      if (typeof i18n.locale === "object" && i18n.locale?.value) return i18n.locale.value;
      return "en";
    },

    getAliases(key: string): string[] {
      // General i18n key lookup
      const parts = key.split(".");
      const defaultValue = parts[parts.length - 1] ?? key;
      const result = t(`${prefix}.${key}`, defaultValue);
      if (Array.isArray(result)) {
        return result.map(String);
      }
      if (typeof result === "string" && result) {
        // Handle comma-separated string
        if (result.includes(",")) {
          return result.split(",").map(s => s.trim()).filter(Boolean);
        }
        return [result];
      }
      return [defaultValue];
    },

    getLabel(key: string): string {
      // General i18n key lookup
      const parts = key.split(".");
      const defaultValue = parts[parts.length - 1] ?? key;
      const result = t(`${prefix}.${key}`, defaultValue);
      return typeof result === "string" ? result : defaultValue;
    },
  };
}
