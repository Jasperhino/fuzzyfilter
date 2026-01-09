/**
 * Built-in Type Handlers
 * 
 * Provides default parse/format/compare handlers for built-in types:
 * string, number, date, boolean, array
 */

import type { TypeHandler } from "../../types/core.ts";
import type { I18nProvider } from "../../types/i18n.ts";
import { parseDate } from "../../date-parser.ts";

/**
 * Built-in type handlers for standard JavaScript types.
 * These are always available and don't need to be registered.
 */
export const BUILT_IN_TYPE_HANDLERS: Record<string, TypeHandler<any>> = {
  string: {
    parse: (input: string) => input,
    format: (value: string) => value,
    compare: (a: string, b: string) => a.localeCompare(b),
  },
  
  number: {
    parse: (input: string) => {
      const n = parseFloat(input);
      return isNaN(n) ? null : n;
    },
    format: (value: number) => String(value),
    compare: (a: number, b: number) => a - b,
  },
  
  date: {
    parse: (input: string, i18n?: I18nProvider) => {
      // Try natural language date parsing first
      const parsed = parseDate(input);
      if (parsed && !parsed.isRange) {
        return parsed.date;
      }
      
      // Fall back to standard Date parsing
      const d = new Date(input);
      return isNaN(d.getTime()) ? null : d;
    },
    format: (value: Date) => value.toLocaleDateString(),
    compare: (a: Date, b: Date) => a.getTime() - b.getTime(),
  },
  
  boolean: {
    parse: (input: string) => {
      const lower = input.toLowerCase();
      if (['true', 'yes', '1', 'on'].includes(lower)) return true;
      if (['false', 'no', '0', 'off'].includes(lower)) return false;
      return null;
    },
    format: (value: boolean) => String(value),
    compare: (a: boolean, b: boolean) => Number(a) - Number(b),
  },
  
  array: {
    parse: (input: string) => {
      // Try to parse as JSON array
      try {
        const parsed = JSON.parse(input);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Not valid JSON, treat as single-element array
        return [input];
      }
      return null;
    },
    format: (value: unknown[]) => {
      if (value.length === 0) return '[]';
      if (value.length === 1) return String(value[0]);
      return `[${value.join(', ')}]`;
    },
    compare: (a: unknown[], b: unknown[]) => {
      // Compare by length first, then lexicographically
      if (a.length !== b.length) return a.length - b.length;
      for (let i = 0; i < a.length; i++) {
        const cmp = String(a[i]).localeCompare(String(b[i]));
        if (cmp !== 0) return cmp;
      }
      return 0;
    },
  },
} as const;

/**
 * Gets a built-in type handler by type name.
 * 
 * @param typeName - The type name ('string', 'number', 'date', etc.)
 * @returns Type handler or undefined if not found
 */
export function getBuiltInTypeHandler(typeName: string): TypeHandler<any> | undefined {
  return BUILT_IN_TYPE_HANDLERS[typeName];
}
