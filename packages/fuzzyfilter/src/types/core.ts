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
// OPERATOR DEFINITION (PATTERN-BASED API)
// ============================================================================

/**
 * Definition for a filter operator using the pattern-based syntax.
 * 
 * The new pattern syntax uses i18n translations exclusively:
 * 
 * | Syntax | Meaning | Resolution |
 * |--------|---------|------------|
 * | `{arg}` or `{name}` | Argument placeholder | User provides value |
 * | `t(key)` | i18n translation key | Resolved via i18nProvider.getAliases() |
 * | `literal` | Literal text | Matches exactly |
 * 
 * All operator aliases (including symbols like `=`, `!=`, `<`) are defined
 * in i18n translations via `t(operators.xxx)` references.
 * 
 * @example
 * ```typescript
 * const customOperator: OperatorDefinition = {
 *   id: 'hasMoreThan',
 *   patterns: ['t(operators.gt) {value}'],
 *   predicate: (operand, { value }) => (operand as number) > (value as number),
 * };
 * ```
 */
export interface OperatorDefinition {
  /** 
   * Unique identifier for this operator.
   * Used as the programmatic key for lookups.
   */
  id: string;
  
  /**
   * Pattern strings for matching user input.
   * 
   * Patterns use a special syntax:
   * - `{}` or `{name}` - Argument placeholder that captures user input
   * - `t(key)` - i18n translation key (resolved via i18nProvider.getAliases(), returns array)
   * - `literal` - Matches text literally
   * 
   * @example
   * ```typescript
   * patterns: [
   *   "t(operators.eq) {value}",           // Matches: "is X", "= X", "equals X"
   *   "t(operators.between) {min} t(operators.and) {max}",  // Matches: "between 1 and 10"
   *   "t(operators.isEmpty)",              // Matches: "is empty", "is blank", etc.
   * ]
   * ```
   */
  patterns: readonly string[];
  
  /**
   * The predicate function that implements the operator logic.
   * REQUIRED for all operators.
   * 
   * @param operand - The value from the cell being filtered
   * @param args - Named arguments extracted from the pattern (e.g., { value }, { min, max })
   * @param row - Optional: the entire row for cross-column logic
   * @returns true if the row matches the filter
   * 
   * @example
   * ```typescript
   * // Simple equality
   * predicate: (operand, { value }) => operand === value
   * 
   * // Between operator
   * predicate: (operand, { min, max }) => operand >= min && operand <= max
   * 
   * // Cross-column comparison
   * predicate: (operand, { value }, row) => {
   *   const endDate = row?.endDate as Date;
   *   return (operand as Date) < endDate;
   * }
   * ```
   */
  predicate: (operand: unknown, args: Record<string, unknown>, row?: Record<string, unknown>) => boolean;
  
  /**
   * Optional type-specific predicates for operators that need different logic per type.
   * When provided, these override the main `predicate` for the specified types.
   * 
   * @example
   * ```typescript
   * predicates: {
   *   date: (operand, { start, end }) => {
   *     const date = operand as Date;
   *     return date >= start && date <= end;
   *   },
   *   number: (operand, { start, end }) => {
   *     return operand >= start && operand <= end;
   *   },
   * }
   * ```
   */
  predicates?: Record<string, (operand: unknown, args: Record<string, unknown>, row?: Record<string, unknown>) => boolean>;
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
