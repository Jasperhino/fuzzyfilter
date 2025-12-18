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
 * const column: ColumnDefinition = {
 *   id: columnId("status"),
 *   name: "Status",
 *   type: "enum", // DataType
 *   values: ["Open", "Closed"],
 * };
 * ```
 */
export type DataType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "array";

/**
 * All supported filter operators.
 *
 * Operators are grouped by category:
 *
 * **Equality**
 * - `eq` - Equals (exact match)
 * - `neq` - Not equals
 * - `eqIgnoreCase` - Equals (case-insensitive)
 * - `neqIgnoreCase` - Not equals (case-insensitive)
 *
 * **Comparison** (for number/date)
 * - `lt` - Less than
 * - `lte` - Less than or equal
 * - `gt` - Greater than
 * - `gte` - Greater than or equal
 *
 * **Set Membership**
 * - `in` - Value is in the set
 * - `nin` - Value is not in the set
 *
 * **Pattern Matching** (for string)
 * - `contains` - Contains substring
 * - `notContains` - Does not contain substring
 * - `startsWith` - Starts with prefix
 * - `endsWith` - Ends with suffix
 *
 * **Nullability**
 * - `isEmpty` - Value is null/undefined/empty
 * - `isNotEmpty` - Value is not null/undefined/empty
 *
 * **Boolean Specific**
 * - `isTrue` - Value is true
 * - `isFalse` - Value is false
 *
 * **Date Specific**
 * - `before` - Before a date
 * - `after` - After a date
 * - `between` - Between two dates
 *
 * @example
 * ```typescript
 * // Use with compileFilter
 * const filter = fuzzyFilter.compileFilter("status", "eq", "Open");
 * const filter = fuzzyFilter.compileFilter("priority", "gte", 3);
 * const filter = fuzzyFilter.compileFilter("name", "contains", "john");
 * ```
 */
export type Operator =
  // Equality
  | "eq"
  | "neq"
  | "eqIgnoreCase"
  | "neqIgnoreCase"
  // Comparison (numeric/date)
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  // Set membership
  | "in"
  | "nin"
  // Pattern matching (string)
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  // Nullability
  | "isEmpty"
  | "isNotEmpty"
  // Boolean specific
  | "isTrue"
  | "isFalse"
  // Date specific
  | "before"
  | "after"
  | "between";

/**
 * Operator metadata for display and validation
 */
export interface OperatorInfo {
  /** The operator identifier */
  id: Operator;
  /** Human-readable label */
  label: string;
  /** Alternative names/aliases for fuzzy matching */
  aliases: string[];
  /** Which data types this operator supports */
  supportedTypes: DataType[];
  /** Does this operator require an argument? */
  requiresArgument: boolean;
  /** For binary operators, can accept multiple values */
  isVariadic?: boolean;
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
