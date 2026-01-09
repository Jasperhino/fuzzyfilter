/**
 * Public API Types
 *
 * This module contains the main interfaces exposed to library consumers,
 * including the core {@link FuzzyFilter} interface and configuration options.
 *
 * @module fuzzyfilter/types/api
 */

import type { OperatorDefinition, FuzzyFilterable } from "./core.ts";
import type { OperatorKey } from "../operators.ts";
import type { Schema, SchemaInput, AnyColumnDefinition } from "./schema.ts";
import type { ParsedInput } from "./parsing.ts";
import type { ScoringWeights, HypothesisGenerationOptions } from "./hypothesis.ts";
import type {
  SuggestionResponse,
  FilterSuggestion,
  CompiledFilter,
  FilterResult,
} from "./results.ts";
import type { I18nProvider } from "./i18n.ts";
import type {
  TelemetryCollector,
  TelemetryConfig,
  IndexProgress,
  IndexDataAsyncOptions,
} from "../telemetry/index.ts";

// ============================================================================
// MAIN FUZZY FILTER INTERFACE
// ============================================================================

/**
 * Configuration options for FuzzyFilter.
 * 
 * @typeParam TCustom - Map of custom type names to their FuzzyFilterable types.
 *                     Only needed when using custom FuzzyFilterable types.
 *                     Native enums don't need to be declared here.
 * 
 * @example With custom FuzzyFilterable type
 * ```typescript
 * class Amount implements FuzzyFilterable<Amount> { ... }
 * 
 * const config: FuzzyFilterConfig<{ amount: Amount }> = {
 *   columns: [
 *     { id: 'weight', labelKey: 'columns.weight', type: 'amount' },
 *   ],
 *   i18n: myI18nProvider,
 *   maxSuggestions: 10,
 * };
 * ```
 * 
 * @example With native enums (no generic needed)
 * ```typescript
 * const config: FuzzyFilterConfig = {
 *   columns: [
 *     { id: 'status', labelKey: 'columns.status', values: ['active', 'inactive'] },
 *   ],
 *   i18n: myI18nProvider,
 *   maxSuggestions: 10,
 * };
 * ```
 */
export interface FuzzyFilterConfig<TCustom extends Record<string, FuzzyFilterable<any>> = {}> {
  /** Maximum suggestions to return. Defaults to 10. */
  maxSuggestions?: number;

  /** Minimum score to include (fuzzysort scale). Defaults to 0.1. */
  minScore?: number;

  /** Scoring weights for ranking. Uses sensible defaults if not provided. */
  scoringWeights?: ScoringWeights;

  /** Enable caching. Defaults to true. */
  enableCache?: boolean;

  /** Cache size limit. Defaults to 1000. */
  maxCacheSize?: number;

  /** Debounce time for suggestions (ms). Defaults to 150. */
  debounceMs?: number;

  /** Enable debug logging. Defaults to true. */
  debug?: boolean;


  /**
   * Enable benchmark/telemetry mode.
   * When true, operations are instrumented with timing spans.
   * @default false
   */
  benchmark?: boolean;

  /**
   * Telemetry configuration options.
   * Only used when benchmark is true.
   */
  telemetryOptions?: Partial<TelemetryConfig>;

  /**
   * Column definitions.
   * 
   * Defines the columns available for filtering, including their types,
   * enum values, and i18n keys.
   */
  columns: SchemaInput<TCustom>["columns"];

  /**
   * Operator definitions. When provided, replaces built-in operators entirely.
   * Spread defaultFuzzyFilterOperators to extend with custom operators:
   * 
   * @example
   * ```typescript
   * operators: [...defaultFuzzyFilterOperators, myCustomOperator]
   * ```
   */
  operators?: OperatorDefinition[];

  /**
   * i18n provider for translations.
   * 
   * Required for proper label resolution and enum value translations.
   */
  i18n: I18nProvider;
}

/**
 * Default configuration.
 * 
 * Note: In V2, `columns` and `i18n` are required and must be provided
 * when creating a FuzzyFilter instance.
 */
export const DEFAULT_CONFIG: Partial<FuzzyFilterConfig> = {
  maxSuggestions: 10,
  minScore: 0.1,
  scoringWeights: {
    column: 0.4,
    operator: 0.35,
    arguments: 0.4,
  },
  enableCache: true,
  maxCacheSize: 1000,
  debounceMs: 150,
  debug: true,
} as const;

/**
 * Main FuzzyFilter interface.
 *
 * FuzzyFilter provides intelligent filter suggestions for data tables and lists.
 * It combines fuzzy string matching with schema awareness to help users build
 * filter expressions quickly and accurately.
 *
 * @typeParam TCustom - Map of custom type names to their FuzzyFilterable types.
 *                     Only needed when using custom FuzzyFilterable types.
 *
 * @example Basic usage with native enums
 * ```typescript
 * import { createFuzzyFilter } from "fuzzyfilter";
 *
 * enum Status { OPEN = 'open', CLOSED = 'closed' }
 *
 * const filter = createFuzzyFilter({
 *   columns: [
 *     { id: "status", labelKey: "columns.status", values: Object.values(Status) },
 *   ],
 *   i18n: myI18nProvider,
 * });
 *
 * // Index data
 * filter.indexData([{ status: Status.OPEN }, { status: Status.CLOSED }]);
 *
 * // Get suggestions
 * const suggestions = await filter.suggest("stat");
 * ```
 * 
 * @example With custom FuzzyFilterable type
 * ```typescript
 * class Amount implements FuzzyFilterable<Amount> { ... }
 *
 * const filter = createFuzzyFilter<{ amount: Amount }>({
 *   columns: [
 *     { id: "weight", labelKey: "columns.weight", type: "amount" },
 *   ],
 *   i18n: myI18nProvider,
 * });
 * ```
 */
export interface FuzzyFilter<TCustom extends Record<string, FuzzyFilterable<any>> = {}> {
  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * The current configuration.
   *
   * @readonly
   */
  readonly config: Readonly<FuzzyFilterConfig<TCustom>>;

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
  configure(options: Partial<FuzzyFilterConfig<TCustom>>): void;

  // -------------------------------------------------------------------------
  // Schema Management
  // -------------------------------------------------------------------------

  /**
   * Sets the schema definition for the filter.
   *
   * The schema defines the available columns, their types, and valid values.
   * In V2, columns are defined in the config, but this method can be used
   * to update the schema after creation.
   *
   * @param schema - The schema definition
   *
   * @example
   * ```typescript
   * filter.setSchema({
   *   columns: [
   *     { id: "status", labelKey: "columns.status", values: ["Open", "Closed"] },
   *     { id: "priority", labelKey: "columns.priority", type: "number" },
   *     { id: "assignee", labelKey: "columns.assignee", type: "string", aliases: ["owner"] },
   *   ],
   * });
   * ```
   */
  setSchema(schema: SchemaInput<TCustom>): void;

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
  getColumn(id: string): AnyColumnDefinition | null;

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
  getOperatorsForColumn(columnId: string): OperatorKey[];

  // -------------------------------------------------------------------------
  // Data Indexing
  // -------------------------------------------------------------------------

  /**
   * Indexes a dataset for searching and counting (synchronous).
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
   * Indexes a dataset asynchronously with UI yielding.
   *
   * Uses requestIdleCallback (or setTimeout fallback) to process data in chunks,
   * allowing the UI to remain responsive during large dataset indexing.
   *
   * @param data - Array of row objects
   * @param options - Async indexing options
   * @returns Promise that resolves when indexing is complete
   *
   * @example
   * ```typescript
   * await filter.indexDataAsync(largeDataset, {
   *   chunkSize: 100,
   *   onProgress: (progress) => {
   *     console.log(`Indexing: ${progress.percentage}%`);
   *   },
   * });
   * ```
   */
  indexDataAsync(
    data: Array<Record<string, unknown>>,
    options?: IndexDataAsyncOptions
  ): Promise<void>;

  /**
   * Upserts (inserts or updates) rows and incrementally updates the index.
   *
   * More efficient than re-indexing the entire dataset when only
   * a few rows have changed.
   *
   * @param rows - Array of rows to upsert
   *
   * @example
   * ```typescript
   * filter.upsertRows([
   *   { rowId: 5, data: { status: "Closed" } }, // Update existing row
   *   { rowId: 10, data: { status: "New" } }, // Insert new row
   * ]);
   * ```
   */
  upsertRows(
    rows: Array<{
      rowId: number;
      data: Record<string, unknown>;
    }>
  ): void;

  /**
   * Deletes rows and incrementally updates the index.
   *
   * More efficient than re-indexing the entire dataset when only
   * a few rows need to be removed.
   *
   * @param rowIds - Array of row IDs to delete
   *
   * @example
   * ```typescript
   * filter.deleteRows([3, 5, 7]); // Delete rows with IDs 3, 5, and 7
   * ```
   */
  deleteRows(rowIds: number[]): void;

  /**
   * Adds a single row and updates the index.
   *
   * @param row - The row data to add
   *
   * @example
   * ```typescript
   * filter.addRow({ status: "Open", priority: 3, assignee: "Charlie" });
   * ```
   */
  addRow(row: Record<string, unknown>): void;

  /**
   * Removes a row by index and updates the index.
   *
   * @param index - The index of the row to remove
   *
   * @example
   * ```typescript
   * filter.removeRow(5);
   * ```
   */
  removeRow(index: number): void;

  /**
   * Removes rows matching a predicate and updates the index.
   *
   * @param predicate - Function that returns true for rows to remove
   *
   * @example
   * ```typescript
   * filter.removeRows((row) => row.status === "Deleted");
   * ```
   */
  removeRows(predicate: (row: Record<string, unknown>) => boolean): void;

  /**
   * Gets the current data array.
   *
   * @returns The indexed data array
   */
  getData(): Array<Record<string, unknown>>;

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
    columnId: string,
    operator: OperatorKey,
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

  // -------------------------------------------------------------------------
  // Telemetry
  // -------------------------------------------------------------------------

  /**
   * Gets the telemetry collector for accessing wide events.
   *
   * Wide Events follow the "Canonical Log Lines" pattern - each operation emits
   * one comprehensive event with all context needed for debugging.
   *
   * Only available when `benchmark: true` is set in config.
   *
   * @returns The telemetry collector, or null if benchmarking is disabled
   *
   * @example
   * ```typescript
   * const filter = createFuzzyFilter({ benchmark: true });
   * // ... perform operations
   * const telemetry = filter.getTelemetry();
   * 
   * // Get all events
   * console.log(telemetry?.getEvents());
   * 
   * // Get events by operation type
   * console.log(telemetry?.getEventsByOperation("suggest"));
   * 
   * // Get summary statistics
   * console.log(telemetry?.getSummary());
   * ```
   */
  getTelemetry(): TelemetryCollector | null;
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
