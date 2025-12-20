/**
 * Core types for the FuzzyFilter library.
 *
 * This module defines the fundamental types used throughout FuzzyFilter,
 * including data types, operators, and identifiers.
 *
 * @module fuzzyfilter/types/core
 */

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

// Note: Operator type is derived from OPERATOR_REGISTRY in operators.ts
// and re-exported from types/index.ts

/**
 * Base operator metadata for display and validation.
 * Used as the constraint type for OPERATOR_REGISTRY.
 * The full OperatorInfo type is derived in registry.ts.
 */
export interface OperatorInfoBase {
  /** Category for grouping operators in UI */
  category: OperatorCategory;
  /** Human-readable label */
  label: string;
  /** Alternative names/aliases for fuzzy matching */
  aliases: readonly string[];
  /**
   * Type-specific aliases that only apply for certain column types.
   * For example, "at" and "on" only make sense for date equality.
   *
   * @example
   * ```typescript
   * typeSpecificAliases: {
   *   date: ["at", "on"],
   * }
   * ```
   */
  typeSpecificAliases?: Partial<Record<DataType, readonly string[]>>;
  /** Which data types this operator supports */
  supportedTypes: readonly DataType[];
  /** Does this operator require an argument? */
  requiresArgument: boolean;
  /** For binary operators, can accept multiple values */
  isVariadic?: boolean;
  /** 
   * Minimum number of arguments required for variadic operators.
   * For example, "between" requires exactly 2, while "in" requires at least 1.
   * Only meaningful when isVariadic is true.
   * @default 1
   */
  minArguments?: number;
  /** Display symbol (e.g., "=" for eq, "!=" for neq) */
  symbol?: string;
}

// ============================================================================
// IDENTIFIERS
// ============================================================================

/**
 * Unique identifier for a column in the schema.
 *
 * This is a branded type (nominal typing) that prevents accidentally
 * passing a regular string where a ColumnId is expected.
 *
 * Use the {@link columnId} helper function to create ColumnId values.
 *
 * @example
 * ```typescript
 * const id: ColumnId = columnId("status");
 * ```
 */
export type ColumnId = string & { readonly __brand: unique symbol };

/**
 * Unique identifier for a row in the dataset.
 *
 * Row IDs are zero-based indices into the data array.
 */
export type RowId = number;

/**
 * Creates a typed ColumnId from a string.
 *
 * ColumnId is a branded type that provides compile-time safety,
 * ensuring you don't accidentally pass arbitrary strings where
 * column identifiers are expected.
 *
 * @param id - The string identifier for the column
 * @returns A branded ColumnId
 *
 * @example
 * ```typescript
 * import { columnId } from "fuzzyfilter";
 *
 * // Creating column IDs for schema definition
 * const statusId = columnId("status");
 * const priorityId = columnId("priority");
 *
 * filter.setSchema({
 *   columns: [
 *     { id: statusId, name: "Status", type: "enum", values: ["Open", "Closed"] },
 *     { id: priorityId, name: "Priority", type: "number" },
 *   ],
 * });
 *
 * // Use the same IDs for programmatic filter creation
 * const compiled = filter.compileFilter(statusId, "eq", "Open");
 * ```
 */
export function columnId(id: string): ColumnId {
  return id as ColumnId;
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
