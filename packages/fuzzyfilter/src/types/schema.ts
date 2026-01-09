/**
 * Schema Layer Types
 *
 * Defines the structure of columns and their metadata for FuzzyFilter.
 * The schema tells FuzzyFilter about your data structure, enabling
 * intelligent suggestions and type-aware operator validation.
 *
 * @module fuzzyfilter/types/schema
 */

import type { ColumnId, DataType } from "./core.ts";
import type { OperatorKey } from "../operators.ts";

// ============================================================================
// COLUMN DEFINITION - Unified V2 API
// ============================================================================

/**
 * Column definition for FuzzyFilter V2.
 * 
 * Supports automatic enum handling when `values` is provided, or explicit
 * type specification for built-in types (string, number, date) or custom
 * FuzzyFilterable types.
 * 
 * @typeParam TTypes - Map of custom type names to their FuzzyFilterable types
 * 
 * @example Native enum (automatic handling)
 * ```typescript
 * enum Status { ACTIVE = 'active', INACTIVE = 'inactive' }
 * 
 * const column: ColumnDefinition = {
 *   id: 'status',
 *   labelKey: 'columns.status',
 *   values: Object.values(Status),
 *   valuesI18nPrefix: 'status', // Maps to 'status.active', 'status.inactive'
 * };
 * ```
 * 
 * @example Built-in type
 * ```typescript
 * const column: ColumnDefinition = {
 *   id: 'name',
 *   labelKey: 'columns.name',
 *   type: 'string',
 * };
 * ```
 * 
 * @example Custom FuzzyFilterable type
 * ```typescript
 * class Amount implements FuzzyFilterable<Amount> { ... }
 * 
 * const column: ColumnDefinition<{ amount: Amount }> = {
 *   id: 'weight',
 *   labelKey: 'columns.weight',
 *   type: 'amount',
 * };
 * ```
 */
export interface ColumnDefinition<TTypes extends Record<string, any> = Record<string, never>> {
  /**
   * Unique identifier for this column.
   */
  id: string;

  /**
   * i18n key for the column label (e.g., "columns.status").
   * 
   * This is required and will be looked up via the i18n provider.
   * The library uses this for display and fuzzy matching.
   */
  labelKey: string;

  /**
   * Data type - required for built-in types (string, number, date) or custom FuzzyFilterable types.
   * Optional when `values` is provided (enum mode - type inferred automatically).
   * 
   * Built-in types: 'string', 'number', 'date'
   * Custom types: keys from the TTypes generic parameter
   */
  type?: keyof (BuiltInTypes & TTypes);

  /**
   * Predefined values for enum-like columns.
   * 
   * When provided, the library automatically handles parsing, formatting, and comparison.
   * Equality operators (eq, neq, in, notIn) work automatically with these values.
   * 
   * The presence of `values` triggers enum mode, making `type` optional.
   */
  values?: unknown[];

  /**
   * i18n key prefix for value labels.
   * 
   * Defaults to column id (e.g., 'status' → 'status.active').
   * Set to match your i18n structure (e.g., 'trackingState' → 'trackingState.incomplete').
   * 
   * The library generates i18n keys as: `{valuesI18nPrefix ?? id}.{value}`
   */
  valuesI18nPrefix?: string;

  /**
   * Alternative names/aliases for fuzzy matching.
   *
   * Users can type any of these to match this column.
   */
  aliases?: string[];

  /**
   * i18n keys for aliases (looked up dynamically via i18n provider).
   *
   * These are resolved at runtime and merged with static `aliases`.
   */
  aliasKeys?: string[];

  /** Whether this column can contain null values */
  nullable?: boolean;

  /** Description for tooltips/help */
  description?: string;

  /**
   * i18n key for the description (e.g., "descriptions.status").
   *
   * When provided, the description will be looked up via the i18n provider.
   * Falls back to `description` if translation is not found.
   */
  descriptionKey?: string;
}

/**
 * Built-in types that are always available.
 */
type BuiltInTypes = {
  string: string;
  number: number;
  date: Date;
  boolean: boolean;
  array: unknown[];
};

/**
 * Union type for all column definitions.
 * 
 * @deprecated In V2, use ColumnDefinition directly. This is kept for backward compatibility.
 */
export type AnyColumnDefinition = ColumnDefinition;

// ============================================================================
// SCHEMA
// ============================================================================

/**
 * Complete schema definition for a filterable dataset
 */
export interface Schema {
  /** All column definitions, keyed by column ID */
  columns: Map<ColumnId, AnyColumnDefinition>;
  /** Column display order */
  columnOrder: ColumnId[];
  /** Default columns to show in suggestions */
  defaultColumns?: ColumnId[];
  /** Schema version for migrations */
  version?: string;
}

/**
 * Input for creating a schema.
 *
 * Pass this to `filter.setSchema()` to configure the filterable columns.
 *
 * @example
 * ```typescript
 * const schemaInput: SchemaInput = {
 *   columns: [
 *     { id: "status", labelKey: "columns.status", values: ["Open", "Closed"] },
 *     { id: "priority", labelKey: "columns.priority", type: "number" },
 *     { id: "assignee", labelKey: "columns.assignee", type: "string" },
 *   ],
 *   defaultColumns: ["status", "assignee"], // Optional: shown first in suggestions
 * };
 *
 * filter.setSchema(schemaInput);
 * ```
 */
export interface SchemaInput<TTypes extends Record<string, any> = Record<string, never>> {
  /** The column definitions */
  columns: ColumnDefinition<TTypes>[];

  /**
   * Column IDs to show by default when query is empty.
   * If not specified, all columns are shown.
   */
  defaultColumns?: string[];
}

// ============================================================================
// OPERATOR MAPPING
// ============================================================================

/**
 * Maps data types to their allowed operators
 */
export interface OperatorMapping {
  /** Get allowed operators for a data type */
  getOperatorsForType(type: DataType): OperatorKey[];
  /** Check if an operator is valid for a type */
  isValidOperator(type: DataType, operator: OperatorKey): boolean;
  /** Get the default operator for a type */
  getDefaultOperator(type: DataType): OperatorKey;
}

// ============================================================================
// COLUMN MATCH RESULT
// ============================================================================

/**
 * Result of matching user input against column names
 */
export interface ColumnMatch {
  /** The matched column */
  column: AnyColumnDefinition;
  /** Match score (higher = better) */
  score: number;
  /** What part of the input matched */
  matchedInput: string;
  /** Indexes for highlighting */
  indexes?: number[];
}
