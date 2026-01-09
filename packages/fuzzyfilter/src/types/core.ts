/**
 * Core types for the FuzzyFilter library.
 *
 * This module defines the fundamental types used throughout FuzzyFilter,
 * including data types, operators, and identifiers.
 *
 * @module fuzzyfilter/types/core
 */

import type { I18nProvider } from "./i18n.ts";

// ============================================================================
// DATA TYPES
// ============================================================================

/**
 * Supported column data types as a const object.
 * Allows enum-style access: DataType.STRING, DataType.DATE, etc.
 * The DataType type is derived from the values.
 */
export const DataType = {
  STRING: "string",
  NUMBER: "number",
  BOOLEAN: "boolean",
  DATE: "date",
  ENUM: "enum",
  ARRAY: "array",
} as const;

/**
 * Supported column data types.
 *
 * These determine which operators are valid for a given column and how
 * values are parsed and compared.
 *
 * | Type | Description | Example Operators |
 * |------|-------------|-------------------|
 * | `string` | Text values | eq, contains, startsWith |
 * | `number` | Numeric values | eq, lt, gt, between |
 * | `boolean` | True/false values | isTrue, isFalse |
 * | `date` | Date/time values | before, after, between |
 * | `enum` | Predefined set of values | eq, in, nin |
 * | `array` | Array of values | contains, isEmpty |
 *
 * @example
 * ```typescript
 * import { DataType } from "fuzzyfilter";
 * 
 * const column: ColumnDefinition = {
 *   id: columnId("status"),
 *   name: "Status",
 *   type: DataType.ENUM,
 *   values: ["Open", "Closed"],
 * };
 * ```
 */
export type DataType = (typeof DataType)[keyof typeof DataType];

/**
 * Operator categories for grouping in documentation and UI.
 * Each category groups related operators by their semantic purpose.
 */
export const OperatorCategory = {
  EQUALITY: "Equality",
  COMPARISON: "Comparison",
  SET_MEMBERSHIP: "Set Membership",
  PATTERN_MATCHING: "Pattern Matching",
  NULLABILITY: "Nullability",
  BOOLEAN: "Boolean",
  DATE: "Date",
} as const;

/**
 * Operator category type - used for grouping operators in UI components.
 */
export type OperatorCategory = (typeof OperatorCategory)[keyof typeof OperatorCategory];

// Note: Operator type is derived from OPERATORS in operators.ts
// and re-exported from types/index.ts


// ============================================================================
// FUZZYFILTERABLE INTERFACE - For custom types
// ============================================================================

/**
 * Interface that custom types must implement to be used in FuzzyFilter.
 * The type itself knows how to parse, format, and compare its values.
 * 
 * @typeParam T - The type itself (for self-referencing)
 * 
 * @example
 * ```typescript
 * class Amount implements FuzzyFilterable<Amount> {
 *   constructor(public value: number, public unit: string) {}
 *   
 *   format(): string {
 *     return `${this.value} ${this.unit}`;
 *   }
 *   
 *   compare(other: Amount): number {
 *     return this.value - other.value;
 *   }
 * }
 * ```
 */
export interface FuzzyFilterable<T> {
  /** Format this value for display in suggestions */
  format(): string;
  
  /** Compare this value to another (-1, 0, 1) for range operators */
  compare(other: T): number;
}

/**
 * Static methods that FuzzyFilterable classes must provide.
 * 
 * @typeParam T - The FuzzyFilterable type
 */
export interface FuzzyFilterableStatic<T extends FuzzyFilterable<T>> {
  /** Parse user input string into an instance */
  parse(input: string): T | null;
}

/**
 * Constructor type combining instance and static requirements.
 */
export type FuzzyFilterableConstructor<T extends FuzzyFilterable<T>> = 
  FuzzyFilterableStatic<T> & (new (...args: any[]) => T);

// ============================================================================
// TYPE HANDLER - Runtime type handling
// ============================================================================

/**
 * Handler for parsing, formatting, and comparing values of a specific type.
 * Used internally by the library to handle both built-in types and custom types.
 * 
 * @typeParam T - The value type
 */
export interface TypeHandler<T> {
  /** Parse user input string into a value */
  parse(input: string, i18n?: I18nProvider): T | null;
  
  /** Format value for display (returns i18n key or literal) */
  format(value: T): string;
  
  /** Compare two values (-1, 0, 1) for range operators */
  compare(a: T, b: T): number;
  
  /** All possible values (for enum-like types) */
  values?: T[];
}

// ============================================================================
// TYPE DEFINITION (LEGACY - kept for backward compatibility during migration)
// ============================================================================

/**
 * Definition for a custom data type.
 * 
 * @deprecated Use FuzzyFilterable interface instead for custom types.
 * This is kept temporarily for migration purposes.
 * 
 * @typeParam TValue - The TypeScript type for values of this type
 */
export interface TypeDefinition<TValue = unknown> {
  /** Unique identifier for this type */
  id: string;
  /** Human-readable label */
  label: string;
  /**
   * Maps to a base DataType for operator compatibility.
   * Operators that support this DataType will be available for columns of this type.
   */
  compatibilityType: DataType;
  /** Parse user input string into typed value */
  parseValue?: (input: string) => TValue | null;
  /** Format typed value for display */
  formatValue?: (value: TValue) => string;
  /** Compare two values (for range operators) */
  compare?: (a: TValue, b: TValue) => number;
}

/**
 * Built-in type definitions that map to DataType values.
 * 
 * @deprecated This is kept for backward compatibility. In v2, built-in types
 * are handled automatically and don't need to be registered.
 */
export const DATA_TYPES: TypeDefinition[] = [
  { id: "string", label: "String", compatibilityType: DataType.STRING },
  { id: "number", label: "Number", compatibilityType: DataType.NUMBER },
  { id: "boolean", label: "Boolean", compatibilityType: DataType.BOOLEAN },
  { id: "date", label: "Date", compatibilityType: DataType.DATE },
  { id: "enum", label: "Enum", compatibilityType: DataType.ENUM },
  { id: "array", label: "Array", compatibilityType: DataType.ARRAY },
];

// ============================================================================
// OPERATOR DEFINITION (PATTERN-BASED API)
// ============================================================================

/**
 * Definition for a filter operator using the pattern-based syntax.
 * 
 * The new pattern syntax consolidates aliases, template patterns, and i18n
 * into a single `patterns` array with special reference syntax:
 * 
 * | Syntax | Meaning | Resolution |
 * |--------|---------|------------|
 * | `{arg}` | Argument placeholder | User provides value |
 * | `@keyword` | Local alias reference | Resolves from `aliases["@keyword"]` |
 * | `$keyword` | i18n translation key | Resolves from `i18nProvider.translate(keyword)` |
 * | `literal` | Literal text | Matches exactly |
 * 
 * @typeParam TValue - The type of cell values this operator handles
 * @typeParam TArgs - The type of arguments passed to the predicate
 * 
 * @example
 * ```typescript
 * const customOperator: OperatorDefinition = {
 *   key: 'hasMoreThan',
 *   category: OperatorCategory.COMPARISON,
 *   patterns: ['@more {value}', 'exceeds {value}'],
 *   aliases: {
 *     '@more': ['more than', 'greater than', '>'],
 *   },
 *   supportedTypes: [DataType.NUMBER],
 *   predicate: (cell, [arg]) => (cell as number) > (arg as number),
 * };
 * ```
 */
export interface OperatorDefinition<TValue = unknown, TArgs extends unknown[] = unknown[]> {
  /** 
   * Unique identifier for this operator.
   * Used as the programmatic key for lookups.
   */
  id: string;
  
  /** Category for grouping operators in UI */
  category: OperatorCategory;
  
  /** Which data types this operator supports */
  supportedTypes: readonly DataType[] | readonly string[];
  
  /**
   * Pattern strings for matching user input.
   * 
   * Patterns use a special syntax:
   * - `{}` or `{name}` - Argument placeholder that captures user input
   * - `@keyword` - Reference to local aliases (resolved from `aliases` field)
   * - `t(key)` - i18n translation key (resolved via i18nProvider.translate(), can return array)
   * - `literal` - Matches text literally
   * 
   * Multi-word literals should use underscores: `not_equals` becomes "not equals" in display.
   * 
   * @example
   * ```typescript
   * patterns: [
   *   "@is {}",                    // Matches: "is X", "= X", "== X"
   *   "t(between) {} @and {}",     // Matches: "between 1 and 10", "zwischen 1 und 10"
   *   "t(operators.isEmpty)",      // Matches: "is empty", "is blank", etc.
   * ]
   * ```
   */
  patterns: readonly string[];
  
  /**
   * Local alias expansions for @keyword references.
   * 
   * Each key (prefixed with @) maps to an array of literal strings
   * or t(key) i18n references that get resolved at runtime.
   * Use underscores for multi-word aliases: "not_equals" instead of "not equals".
   * 
   * @example
   * ```typescript
   * aliases: {
   *   "@eq": ["=", "==", "is", "equal", "equals", "t(operators.eq)"],
   *   "@and": ["and", "&", "t(and)"],
   * }
   * ```
   */
  aliases?: Record<string, readonly string[]>;
  
  /**
   * Type-specific patterns that only apply for certain column types.
   * For example, "at" and "on" only make sense for date equality.
   * 
   * @example
   * ```typescript
   * typeSpecificPatterns: {
   *   [DataType.DATE]: ["at {value}", "on {value}"],
   * }
   * ```
   */
  typeSpecificPatterns?: Partial<Record<DataType, readonly string[]>>;
  
  /**
   * The predicate function that implements the operator logic.
   * REQUIRED for all operators.
   * 
   * @param cellValue - The value from the cell being filtered
   * @param args - The filter argument(s) as an array
   * @param row - Optional: the entire row for cross-column logic
   * @returns true if the row matches the filter
   * 
   * @example
   * ```typescript
   * // Simple equality
   * predicate: (cell, [arg]) => cell === arg
   * 
   * // Between operator
   * predicate: (cell, [min, max]) => cell >= min && cell <= max
   * 
   * // Cross-column comparison
   * predicate: (cell, [_arg], row) => {
   *   const endDate = row?.endDate as Date;
   *   return (cell as Date) < endDate;
   * }
   * ```
   */
  predicate: (cellValue: TValue, args: TArgs, row?: Record<string, unknown>) => boolean;
}

// ============================================================================
// IDENTIFIERS
// ============================================================================

/**
 * Unique identifier for a column in the schema.
 *
 * @example
 * ```typescript
 * { id: "status", name: "Status", type: "enum", ... }
 * ```
 */
export type ColumnId = string;

/**
 * Unique identifier for a row in the dataset.
 *
 * Row IDs are zero-based indices into the data array.
 */
export type RowId = number;

/**
 * Creates a ColumnId from a string.
 *
 * **Note:** This helper is optional. Plain strings are accepted everywhere
 * in the FuzzyFilter API.
 *
 * @param id - The string identifier for the column
 * @returns The column ID as a string
 *
 * @example
 * ```typescript
 * import { createFuzzyFilter } from "fuzzyfilter";
 *
 * const filter = createFuzzyFilter();
 *
 * // Recommended: Just use plain strings
 * filter.setSchema({
 *   columns: [
 *     { id: "status", name: "Status", type: "enum", values: ["Open", "Closed"] },
 *     { id: "priority", name: "Priority", type: "number" },
 *   ],
 * });
 *
 * // Plain strings work for all API calls
 * const compiled = filter.compileFilter("status", "eq", "Open");
 * ```
 */
export function columnId(id: string): ColumnId {
  return id;
}

// ============================================================================
// MATCH RESULT
// ============================================================================

/**
 * A match result from fuzzy search
 */
export interface Match<T> {
  /** The matched item */
  item: T;
  /** Score from fuzzysort (higher = better match) */
  score: number;
  /** Which characters matched (for highlighting) */
  indexes?: number[];
}
