/**
 * Public API Types
 *
 * This module contains the main interfaces exposed to library consumers,
 * including the core {@link FuzzyFilter} interface and configuration options.
 *
 * @module fuzzyfilter/types/api
 */

import type { ColumnId, DataType, Operator } from "./core.ts";
import type { Schema, SchemaInput, AnyColumnDefinition } from "./schema.ts";
import type { DataIndex } from "./index-layer.ts";
import type { ParsedInput } from "./parsing.ts";
import type { ScoringWeights, HypothesisGenerationOptions } from "./hypothesis.ts";
import type {
  SuggestionResponse,
  FilterSuggestion,
  CompiledFilter,
  FilterResult,
  CountOptions,
} from "./results.ts";

// ============================================================================
// MAIN FUZZY FILTER INTERFACE
// ============================================================================

/**
 * Configuration options for FuzzyFilter
 */
export interface FuzzyFilterConfig {
  /** Maximum suggestions to return */
  maxSuggestions: number;

  /** Minimum score to include (fuzzysort scale) */
  minScore: number;

  /** Scoring weights for ranking */
  scoringWeights: ScoringWeights;

  /** Hypothesis generation options */
  hypothesisOptions: Partial<HypothesisGenerationOptions>;

  /** Count calculation options */
  countOptions: Partial<CountOptions>;

  /** Enable caching */
  enableCache: boolean;

  /** Cache size limit */
  maxCacheSize: number;

  /** Debounce time for suggestions (ms) */
  debounceMs: number;

  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: FuzzyFilterConfig = {
  maxSuggestions: 10,
  minScore: -10000, // fuzzysort uses negative scores, higher = better
  scoringWeights: {
    column: 0.4,
    operator: 0.35,
    argument: 0.25,
    orderBonus: 0.1,
    inferredPenalty: 0.15,
    completenessBonus: 0.2,
  },
  hypothesisOptions: {
    maxHypotheses: 50,
    maxEditDistance: 2,
  },
  countOptions: {
    timeout: 100,
    useCache: true,
    cacheTtl: 60,
  },
  enableCache: true,
  maxCacheSize: 1000,
  debounceMs: 150,
  debug: false,
} as const;

/**
 * Main FuzzyFilter interface.
 *
 * FuzzyFilter provides intelligent filter suggestions for data tables and lists.
 * It combines fuzzy string matching with schema awareness to help users build
 * filter expressions quickly and accurately.
 *
 * @example Basic usage
 * ```typescript
 * import { createFuzzyFilter, columnId } from "fuzzyfilter";
 *
 * const filter = createFuzzyFilter();
 *
 * // Define schema
 * filter.setSchema({
 *   columns: [
 *     { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
 *   ],
 * });
 *
 * // Index data
 * filter.indexData([{ status: "Open" }, { status: "Closed" }]);
 *
 * // Get suggestions
 * const suggestions = await filter.suggest("stat");
 * ```
 */
export interface FuzzyFilter {
  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * The current configuration.
   *
   * @readonly
   */
  readonly config: Readonly<FuzzyFilterConfig>;

  /**
   * Updates the configuration.
   *
   * @param options - Partial configuration to merge with current settings
   *
   * @example
   * ```typescript
   * filter.configure({ maxSuggestions: 20, debounceMs: 200 });
   * ```
   */
  configure(options: Partial<FuzzyFilterConfig>): void;

  // -------------------------------------------------------------------------
  // Schema Management
  // -------------------------------------------------------------------------

  /**
   * Sets the schema definition for the filter.
   *
   * The schema defines the available columns, their types, and valid values.
   * This must be called before indexing data or generating suggestions.
   *
   * @param schema - The schema definition
   *
   * @example
   * ```typescript
   * filter.setSchema({
   *   columns: [
   *     { id: columnId("status"), name: "Status", type: "enum", values: ["Open", "Closed"] },
   *     { id: columnId("priority"), name: "Priority", type: "number" },
   *     { id: columnId("assignee"), name: "Assignee", type: "string", aliases: ["owner"] },
   *   ],
   * });
   * ```
   */
  setSchema(schema: SchemaInput): void;

  /**
   * Returns the current schema, or null if not set.
   */
  getSchema(): Schema | null;

  /**
   * Gets a column definition by ID.
   *
   * @param id - The column ID (ColumnId or string)
   * @returns The column definition, or null if not found
   */
  getColumn(id: ColumnId | string): AnyColumnDefinition | null;

  /**
   * Gets all operators valid for a specific column.
   *
   * @param columnId - The column ID
   * @returns Array of valid operators for the column's data type
   *
   * @example
   * ```typescript
   * const ops = filter.getOperatorsForColumn("priority");
   * // → ["eq", "neq", "lt", "lte", "gt", "gte", "in", "nin", "isEmpty", "isNotEmpty"]
   * ```
   */
  getOperatorsForColumn(columnId: ColumnId | string): Operator[];

  // -------------------------------------------------------------------------
  // Data Indexing
  // -------------------------------------------------------------------------

  /**
   * Indexes a dataset for searching and counting.
   *
   * This builds internal data structures (tries, bitmaps) that enable fast
   * fuzzy searching and result counting. Call this after setting the schema.
   *
   * @param data - Array of row objects
   *
   * @example
   * ```typescript
   * filter.indexData([
   *   { status: "Open", priority: 3, assignee: "Alice" },
   *   { status: "Closed", priority: 1, assignee: "Bob" },
   * ]);
   * ```
   */
  indexData(data: Array<Record<string, unknown>>): void;

  /**
   * Updates the index incrementally for changed rows.
   *
   * More efficient than re-indexing the entire dataset when only
   * a few rows have changed.
   *
   * @param changes - Array of row changes
   *
   * @example
   * ```typescript
   * filter.updateRows([
   *   { rowId: 5, oldData: { status: "Open" }, newData: { status: "Closed" } },
   *   { rowId: 10, newData: { status: "New" } }, // Insert
   *   { rowId: 3, oldData: { status: "Open" } }, // Delete
   * ]);
   * ```
   */
  updateRows(
    changes: Array<{
      rowId: number;
      oldData?: Record<string, unknown>;
      newData?: Record<string, unknown>;
    }>
  ): void;

  /**
   * Clears all indexed data.
   *
   * The schema is preserved. Call indexData() to re-index.
   */
  clearIndex(): void;

  /**
   * Returns statistics about the current index.
   *
   * @returns Object with totalRows, columnsIndexed, uniqueValues, indexSizeBytes
   */
  getIndexStats(): {
    totalRows: number;
    columnsIndexed: number;
    uniqueValues: number;
    indexSizeBytes: number;
  };

  // -------------------------------------------------------------------------
  // Suggestions
  // -------------------------------------------------------------------------

  /**
   * Gets filter suggestions for user input (async).
   *
   * Returns ranked suggestions based on fuzzy matching against columns,
   * operators, and indexed values. Each suggestion includes a result count.
   *
   * @param query - The user's input text
   * @param cursorPosition - Optional cursor position for context-aware suggestions
   * @param filterContext - Optional array of already-applied filters. Result counts
   *                       will be computed against the subset of data matching all
   *                       context filters (AND semantics).
   * @returns Promise resolving to suggestion response
   *
   * @example
   * ```typescript
   * const response = await filter.suggest("stat eq");
   * console.log(response.suggestions);
   * // → [
   * //     { label: "Status = Open", resultCount: 5 },
   * //     { label: "Status = Closed", resultCount: 3 },
   * //   ]
   * ```
   *
   * @example With filter context
   * ```typescript
   * const statusFilter = filter.compileFilter("status", "eq", "Open");
   * const response = await filter.suggest("assignee", undefined, [statusFilter]);
   * // Result counts reflect only rows where status = "Open"
   * ```
   */
  suggest(query: string, cursorPosition?: number, filterContext?: CompiledFilter[]): Promise<SuggestionResponse>;

  /**
   * Gets filter suggestions synchronously.
   *
   * Same as suggest() but synchronous. May be slower for large datasets.
   *
   * @param query - The user's input text
   * @param cursorPosition - Optional cursor position
   * @param filterContext - Optional array of already-applied filters for stacked counting
   * @returns Suggestion response
   */
  suggestSync(query: string, cursorPosition?: number, filterContext?: CompiledFilter[]): SuggestionResponse;

  // -------------------------------------------------------------------------
  // Parsing
  // -------------------------------------------------------------------------

  /**
   * Parses user input into a structured form.
   *
   * Identifies column, operator, and value components from the input.
   *
   * @param input - The filter expression to parse
   * @returns Parsed input with identified components
   *
   * @example
   * ```typescript
   * const parsed = filter.parse("status eq Open");
   * console.log(parsed.column?.match.column.name); // "Status"
   * console.log(parsed.operator?.match.operator);  // "eq"
   * ```
   */
  parse(input: string): ParsedInput;

  /**
   * Validates a filter expression.
   *
   * Checks if the expression is complete and syntactically valid.
   *
   * @param input - The filter expression to validate
   * @returns Validation result with valid flag and any errors
   *
   * @example
   * ```typescript
   * const result = filter.validate("status eq");
   * if (!result.valid) {
   *   console.log(result.errors); // ["Operator 'equals' requires a value"]
   * }
   * ```
   */
  validate(input: string): {
    valid: boolean;
    errors: string[];
    parsed?: ParsedInput;
  };

  // -------------------------------------------------------------------------
  // Filter Compilation & Execution
  // -------------------------------------------------------------------------

  /**
   * Compiles a filter expression string into an executable filter.
   *
   * @param input - The filter expression (e.g., "status eq Open")
   * @returns Compiled filter, or null if invalid
   *
   * @example
   * ```typescript
   * const compiled = filter.compile("status eq Open");
   * if (compiled) {
   *   const matches = myData.filter(compiled.predicate);
   * }
   * ```
   */
  compile(input: string): CompiledFilter | null;

  /**
   * Compiles a filter from structured components.
   *
   * Useful for programmatic filter creation without parsing.
   *
   * @param columnId - The column ID
   * @param operator - The operator
   * @param value - The comparison value (optional for some operators)
   * @returns Compiled filter, or null if invalid
   *
   * @example
   * ```typescript
   * const compiled = filter.compileFilter("priority", "gte", 3);
   * const compiled = filter.compileFilter("name", "contains", "john");
   * const compiled = filter.compileFilter("status", "isEmpty");
   * ```
   */
  compileFilter(
    columnId: ColumnId | string,
    operator: Operator,
    value?: unknown
  ): CompiledFilter | null;

  /**
   * Executes a compiled filter and returns matching row IDs.
   *
   * @param filter - The compiled filter
   * @returns Filter result with matching rows and timing info
   *
   * @example
   * ```typescript
   * const compiled = filter.compile("status eq Open");
   * const result = filter.execute(compiled);
   * console.log(result.matchingRows); // [0, 3, 7]
   * console.log(result.executionTimeMs); // 0.5
   * ```
   */
  execute(filter: CompiledFilter): FilterResult;

  /**
   * Gets the count for a filter without full execution.
   *
   * @param filter - The compiled filter
   * @returns Number of matching rows
   */
  count(filter: CompiledFilter): number;

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  /**
   * Clears internal caches.
   *
   * Call this when you need to force fresh calculations.
   */
  clearCache(): void;

  /**
   * Destroys the instance and frees resources.
   *
   * Call this when you're done with the filter to clean up memory.
   */
  destroy(): void;
}

// ============================================================================
// FACTORY FUNCTION TYPE
// ============================================================================

/**
 * Create a new FuzzyFilter instance
 */
export type CreateFuzzyFilter = (config?: Partial<FuzzyFilterConfig>) => FuzzyFilter;

// ============================================================================
// REACT HOOK TYPES (Optional integration)
// ============================================================================

/**
 * State for React integration
 */
export interface UseFuzzyFilterState {
  /** Current query */
  query: string;
  /** Current suggestions */
  suggestions: FilterSuggestion[];
  /** Is loading suggestions? */
  isLoading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Selected suggestion index */
  selectedIndex: number;
}

/**
 * Actions for React integration
 */
export interface UseFuzzyFilterActions {
  /** Update the query */
  setQuery: (query: string) => void;
  /** Select a suggestion */
  selectSuggestion: (index: number) => void;
  /** Apply the selected suggestion */
  applySuggestion: () => void;
  /** Navigate suggestions */
  navigateSuggestions: (direction: "up" | "down") => void;
  /** Clear everything */
  reset: () => void;
}

/**
 * Complete hook return type
 */
export type UseFuzzyFilterReturn = UseFuzzyFilterState & UseFuzzyFilterActions;

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Events emitted by FuzzyFilter
 */
export type FuzzyFilterEvent =
  | { type: "schemaChange"; schema: Schema }
  | { type: "indexChange"; stats: { totalRows: number } }
  | { type: "suggestStart"; query: string }
  | { type: "suggestComplete"; query: string; count: number; timeMs: number }
  | { type: "suggestError"; query: string; error: Error }
  | { type: "cacheHit"; key: string }
  | { type: "cacheMiss"; key: string }
  | { type: "cacheEvict"; count: number };

/**
 * Event listener type
 */
export type FuzzyFilterEventListener = (event: FuzzyFilterEvent) => void;

/**
 * Event emitter interface
 */
export interface FuzzyFilterEventEmitter {
  on(listener: FuzzyFilterEventListener): () => void;
  off(listener: FuzzyFilterEventListener): void;
  emit(event: FuzzyFilterEvent): void;
}
