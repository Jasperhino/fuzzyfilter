/**
 * Schema Layer Types
 *
 * Defines the structure of columns and their metadata for FuzzyFilter.
 * The schema tells FuzzyFilter about your data structure, enabling
 * intelligent suggestions and type-aware operator validation.
 *
 * @module fuzzyfilter/types/schema
 */

import type { ColumnId, DataType, Operator } from "./core.ts";

// ============================================================================
// COLUMN DEFINITION
// ============================================================================

/**
 * Base column definition with common properties.
 *
 * All column types extend this interface with type-specific properties.
 *
 * @typeParam T - The data type for this column
 *
 * @example
 * ```typescript
 * const column: ColumnDefinition<"string"> = {
 *   id: columnId("name"),
 *   name: "Name",
 *   type: "string",
 *   aliases: ["title", "label"], // Alternative names users might type
 *   description: "The display name",
 * };
 * ```
 */
export interface ColumnDefinition<T extends DataType = DataType> {
  /**
   * Unique identifier for this column.
   *
   * Use the `columnId()` helper to create typed IDs.
   */
  id: ColumnId;

  /**
   * Display name for the column.
   *
   * This is what users see in suggestions and what they can type to match.
   */
  name: string;

  /**
   * Alternative names/aliases for fuzzy matching.
   *
   * Users can type any of these to match this column.
   *
   * @example
   * ```typescript
   * {
   *   name: "Created At",
   *   aliases: ["created", "date", "timestamp", "when"]
   * }
   * ```
   */
  aliases?: string[];

  /** The data type of this column */
  type: T;

  /** Whether this column can contain null values */
  nullable?: boolean;

  /** Description for tooltips/help */
  description?: string;
}

/**
 * String column definition.
 *
 * For free-form text values. Supports pattern matching operators like
 * `contains`, `startsWith`, and `endsWith`.
 *
 * @example
 * ```typescript
 * {
 *   id: columnId("name"),
 *   name: "Name",
 *   type: "string",
 *   caseSensitive: false,
 * }
 * ```
 */
export interface StringColumnDefinition extends ColumnDefinition<"string"> {
  /** If provided, restricts valid values to this set */
  allowedValues?: string[];
  /** Case sensitivity for matching (default: false) */
  caseSensitive?: boolean;
}

/**
 * Numeric column definition.
 *
 * For integer and floating-point values. Supports comparison operators
 * like `lt`, `gt`, `gte`, `lte`.
 *
 * @example
 * ```typescript
 * {
 *   id: columnId("priority"),
 *   name: "Priority",
 *   type: "number",
 *   min: 1,
 *   max: 5,
 *   isInteger: true,
 * }
 * ```
 */
export interface NumberColumnDefinition extends ColumnDefinition<"number"> {
  /** Minimum allowed value (for validation) */
  min?: number;
  /** Maximum allowed value (for validation) */
  max?: number;
  /** Whether values are integers only (default: false) */
  isInteger?: boolean;
}

/**
 * Date column definition.
 *
 * For date/time values. Supports natural language parsing via chrono-node
 * (e.g., "yesterday", "last week", "next month") and date-specific operators
 * like `before`, `after`, `between`.
 *
 * @example
 * ```typescript
 * {
 *   id: columnId("createdAt"),
 *   name: "Created At",
 *   type: "date",
 *   granularity: "day",
 * }
 * ```
 */
export interface DateColumnDefinition extends ColumnDefinition<"date"> {
  /** Date granularity for display/parsing */
  granularity?: "year" | "month" | "day" | "hour" | "minute" | "second";
  /** Timezone for date operations (e.g., "America/New_York") */
  timezone?: string;
}

/**
 * Enum column definition.
 *
 * For columns with a fixed set of allowed values. The values are indexed
 * for fast fuzzy matching and suggestions.
 *
 * @example
 * ```typescript
 * {
 *   id: columnId("status"),
 *   name: "Status",
 *   type: "enum",
 *   values: ["Open", "In Progress", "Closed", "Blocked"],
 *   labels: ["Open", "In Progress", "Closed", "Blocked"], // Optional display labels
 * }
 * ```
 */
export interface EnumColumnDefinition extends ColumnDefinition<"enum"> {
  /** The allowed enum values */
  values: string[];
  /** Display labels for each value (parallel array, optional) */
  labels?: string[];
}

/**
 * Boolean column definition.
 *
 * For true/false values. Supports `isTrue` and `isFalse` operators.
 *
 * @example
 * ```typescript
 * {
 *   id: columnId("isBlocked"),
 *   name: "Is Blocked",
 *   type: "boolean",
 *   trueLabel: "Blocked",
 *   falseLabel: "Not Blocked",
 * }
 * ```
 */
export interface BooleanColumnDefinition extends ColumnDefinition<"boolean"> {
  /** Custom label for true values */
  trueLabel?: string;
  /** Custom label for false values */
  falseLabel?: string;
}

/**
 * Array column definition.
 *
 * For columns containing arrays of values. Supports `contains` and
 * `isEmpty` operators.
 *
 * @example
 * ```typescript
 * {
 *   id: columnId("tags"),
 *   name: "Tags",
 *   type: "array",
 *   elementType: "string",
 * }
 * ```
 */
export interface ArrayColumnDefinition extends ColumnDefinition<"array"> {
  /** The type of elements in the array */
  elementType: Exclude<DataType, "array">;
}

/**
 * Union type for all column definitions
 */
export type AnyColumnDefinition =
  | StringColumnDefinition
  | NumberColumnDefinition
  | DateColumnDefinition
  | EnumColumnDefinition
  | BooleanColumnDefinition
  | ArrayColumnDefinition;

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
 *     { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
 *     { id: columnId("priority"), name: "Priority", type: "number" },
 *     { id: columnId("assignee"), name: "Assignee", type: "string" },
 *   ],
 *   defaultColumns: ["status", "assignee"], // Optional: shown first in suggestions
 * };
 *
 * filter.setSchema(schemaInput);
 * ```
 */
export interface SchemaInput {
  /** The column definitions */
  columns: AnyColumnDefinition[];

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
  getOperatorsForType(type: DataType): Operator[];
  /** Check if an operator is valid for a type */
  isValidOperator(type: DataType, operator: Operator): boolean;
  /** Get the default operator for a type */
  getDefaultOperator(type: DataType): Operator;
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
