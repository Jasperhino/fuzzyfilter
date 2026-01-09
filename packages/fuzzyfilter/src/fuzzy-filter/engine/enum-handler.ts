/**
 * Enum Handler
 * 
 * Automatically generates type handlers for columns with `values` defined.
 * Handles parsing, formatting, and comparison for enum-like types.
 */

import type { TypeHandler } from "../../types/core.ts";
import type { ColumnDefinition } from "../../types/schema.ts";
import type { I18nProvider } from "../../types/i18n.ts";

/**
 * Creates a type handler for columns with predefined values (enum mode).
 * 
 * When a column has `values` defined, this function generates handlers that:
 * - Parse: Match user input against i18n aliases for each value
 * - Format: Return i18n key `{prefix}.{value}` for display
 * - Compare: Use array index order
 * 
 * @param column - The column definition with values
 * @param i18n - The i18n provider for translations
 * @returns Type handler for enum values
 * 
 * @example
 * ```typescript
 * const column: ColumnDefinition = {
 *   id: 'status',
 *   labelKey: 'columns.status',
 *   values: ['active', 'inactive'],
 *   valuesI18nPrefix: 'status',
 * };
 * 
 * const handler = createEnumHandlerFromValues(column, i18nProvider);
 * handler.parse('aktiv', i18nProvider); // → 'active' (matched via i18n alias)
 * handler.format('active'); // → 'status.active' (i18n key)
 * handler.compare('active', 'inactive'); // → -1 (array index order)
 * ```
 */
export function createEnumHandlerFromValues(
  column: ColumnDefinition<any>,
  i18n: I18nProvider
): TypeHandler<unknown> {
  const values = column.values!;
  const prefix = column.valuesI18nPrefix ?? (typeof column.id === 'string' ? column.id : String(column.id));
  
  return {
    values,
    
    parse(input: string, i18nProvider?: I18nProvider): unknown | null {
      const provider = i18nProvider ?? i18n;
      
      // Try to match against i18n aliases for each value
      for (const value of values) {
        const key = `${prefix}.${value}`;
        const aliases = provider.getAliases(key);
        
        // Match against translated aliases (case-insensitive)
        if (aliases.some(alias => alias.toLowerCase() === input.toLowerCase())) {
          return value;
        }
        
        // Also match against raw value (case-insensitive)
        if (String(value).toLowerCase() === input.toLowerCase()) {
          return value;
        }
      }
      
      return null;
    },
    
    format(value: unknown): string {
      // Return i18n key for display (will be resolved by library)
      return `${prefix}.${value}`;
    },
    
    compare(a: unknown, b: unknown): number {
      // Use array index order for comparison
      const indexA = values.indexOf(a);
      const indexB = values.indexOf(b);
      
      // If values not found, put them at the end
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      
      return indexA - indexB;
    },
  };
}
