/**
 * Public API Types
 *
 * This module contains the main interfaces exposed to library consumers,
 * including the core {@link FuzzyFilter} interface and configuration options.
 *
 * @module fuzzyfilter/types/api
 */

import type { ParsedInput } from "./parsing.ts";
import type {
  SuggestionResponse,
  FilterSuggestion,
  CompiledFilter,
  FilterResult,
} from "./results.ts";
import type {
  TelemetryCollector,
  TelemetryConfig,
  IndexDataAsyncOptions,
} from "../telemetry/index.ts";
import type {
  FieldSchema,
  ParserRegistry,
  FieldCentricTranslations,
  OperatorOverload,
} from "./field-centric.ts";
import type { UnitDefinition } from "../units/types.ts";

/**
 * Scoring weights for ranking suggestions.
 */
export interface ScoringWeights {
  column?: number;
  operator?: number;
  arguments?: number;
}

/**
 * Configuration options for FuzzyFilter.
 * 
 * @example
 * ```typescript
 * const config: FuzzyFilterConfig = {
 *   fields: {
 *     date: {
 *       labelKey: 'columns.date',
 *       operandSchema: z.date(),
 *       operators: [{
 *         operatorId: 'gt',
 *         overloads: [{
 *           id: 'date:gt:date',
 *           i18nKey: 'operators.date.after',
 *           argumentSchema: z.object({ value: z.date() }),
 *           predicate: (operand, { value }) => operand.getTime() > value.getTime(),
 *         }],
 *       }],
 *     },
 *   },
 *   parsers: {
 *     date: new DateParser(),
 *   },
 *   translations: {
 *     en: { operators: { date: { after: ['after', 'later than'] } } },
 *   },
 * };
 * ```
 */
export interface FuzzyFilterConfig {
  /**
   * Field-centric configuration.
   * 
   * Each field owns its operators and overloads, allowing:
   * - Multiple operator signatures per field (e.g., percentage vs amount)
   * - Field-specific i18n keys for operators
   * - Type-safe argument schemas using Zod
   */
  fields: Record<string, FieldSchema<any>>;

  /**
   * Argument parsers for extracting typed values from user input.
   * 
   * Parsers are used to extract structured arguments (dates, amounts, etc.)
   * from free-form user queries.
   */
  parsers: ParserRegistry;

  /**
   * Translations for fields and operators.
   * 
   * Supports nested paths for field-specific and overload-specific translations.
   */
  translations: FieldCentricTranslations;

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

  /** Enable debug logging. Defaults to false. */
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
   * Unit definitions for value parsing.
   * Units enable fuzzy matching of unit names/symbols and conversion.
   *
   * @example
   * ```typescript
   * units: [
   *   { id: 'kg', dimension: 'mass', toBase: 1, i18nKey: 'units.mass.kg' },
   *   { id: 'g', dimension: 'mass', toBase: 0.001, i18nKey: 'units.mass.g' },
   * ]
   * ```
   */
  units?: UnitDefinition[];
}

/**
 * Main FuzzyFilter interface.
 *
 * FuzzyFilter provides intelligent filter suggestions for data tables and lists.
 * It combines fuzzy string matching with schema awareness to help users build
 * filter expressions quickly and accurately.
 *
 * @example
 * ```typescript
 * import { FuzzyFilter } from "@jasperhino/fuzzyfilter";
 *
 * const filter = new FuzzyFilter({
 *   fields: { ... },
 *   parsers: { ... },
 *   translations: { ... },
 * });
 *
 * filter.indexData(myData);
 * const suggestions = await filter.suggest("biochar > 30");
 * ```
 */
export interface FuzzyFilter {
  /**
   * The current configuration.
   * @readonly
   */
  readonly config: Readonly<FuzzyFilterConfig>;

  /**
   * Updates the configuration.
   * @param options - Partial configuration to merge with current settings
   */
  configure(options: Partial<FuzzyFilterConfig>): void;

  /**
   * Gets a field schema by key.
   * @param fieldKey - The field key
   * @returns The field schema, or null if not found
   */
  getField(fieldKey: string): FieldSchema<any> | null;

  /**
   * Gets all operator overloads for a specific field.
   * @param fieldKey - The field key
   * @returns Array of all overloads across all operators
   */
  getOverloadsForField(fieldKey: string): OperatorOverload<any, any>[];

  /**
   * Indexes a dataset for searching and counting (synchronous).
   * @param data - Array of row objects
   */
  indexData(data: Array<Record<string, unknown>>): void;

  /**
   * Indexes a dataset asynchronously with UI yielding.
   * @param data - Array of row objects
   * @param options - Async indexing options
   * @returns Promise that resolves when indexing is complete
   */
  indexDataAsync(
    data: Array<Record<string, unknown>>,
    options?: IndexDataAsyncOptions
  ): Promise<void>;

  /**
   * Upserts (inserts or updates) rows and incrementally updates the index.
   * @param rows - Array of rows to upsert
   */
  upsertRows(
    rows: Array<{
      rowId: number;
      data: Record<string, unknown>;
    }>
  ): void;

  /**
   * Deletes rows and incrementally updates the index.
   * @param rowIds - Array of row IDs to delete
   */
  deleteRows(rowIds: number[]): void;

  /**
   * Adds a single row and updates the index.
   * @param row - The row data to add
   */
  addRow(row: Record<string, unknown>): void;

  /**
   * Removes a row by index and updates the index.
   * @param index - The index of the row to remove
   */
  removeRow(index: number): void;

  /**
   * Removes rows matching a predicate and updates the index.
   * @param predicate - Function that returns true for rows to remove
   */
  removeRows(predicate: (row: Record<string, unknown>) => boolean): void;

  /**
   * Gets the current data array.
   * @returns The indexed data array
   */
  getData(): Array<Record<string, unknown>>;

  /**
   * Clears all indexed data.
   */
  clearIndex(): void;

  /**
   * Returns statistics about the current index.
   */
  getIndexStats(): {
    totalRows: number;
    fieldsIndexed: number;
    uniqueValues: number;
    indexSizeBytes: number;
  };

  /**
   * Gets filter suggestions for user input (async).
   * @param query - The user's input text
   * @param cursorPosition - Optional cursor position for context-aware suggestions
   * @param filterContext - Optional array of already-applied filters
   * @returns Promise resolving to suggestion response
   */
  suggest(query: string, cursorPosition?: number, filterContext?: CompiledFilter[]): Promise<SuggestionResponse>;

  /**
   * Gets filter suggestions synchronously.
   * @param query - The user's input text
   * @param cursorPosition - Optional cursor position
   * @param filterContext - Optional array of already-applied filters
   * @returns Suggestion response
   */
  suggestSync(query: string, cursorPosition?: number, filterContext?: CompiledFilter[]): SuggestionResponse;

  /**
   * Parses user input into a structured form.
   * @param input - The filter expression to parse
   * @returns Parsed input with identified components
   */
  parse(input: string): ParsedInput;

  /**
   * Validates a filter expression.
   * @param input - The filter expression to validate
   * @returns Validation result with valid flag and any errors
   */
  validate(input: string): {
    valid: boolean;
    errors: string[];
    parsed?: ParsedInput;
  };

  /**
   * Compiles a filter expression string into an executable filter.
   * @param input - The filter expression (e.g., "status eq Open")
   * @returns Compiled filter, or null if invalid
   */
  compile(input: string): CompiledFilter | null;

  /**
   * Compiles a filter from an overload ID and arguments.
   * @param overloadId - The overload ID (e.g., "date:gt:date", "contents:gt:percentage+materialTypes[]")
   * @param args - The arguments for the predicate
   * @returns Compiled filter, or null if invalid
   */
  compileFromOverload(
    overloadId: string,
    args: Record<string, unknown>
  ): CompiledFilter | null;

  /**
   * Executes a compiled filter and returns matching row IDs.
   * @param filter - The compiled filter
   * @returns Filter result with matching rows and timing info
   */
  execute(filter: CompiledFilter): FilterResult;

  /**
   * Gets the count for a filter without full execution.
   * @param filter - The compiled filter
   * @returns Number of matching rows
   */
  count(filter: CompiledFilter): number;

  /**
   * Clears internal caches.
   */
  clearCache(): void;

  /**
   * Destroys the instance and frees resources.
   */
  destroy(): void;

  /**
   * Gets the telemetry collector for accessing wide events.
   * Only available when `benchmark: true` is set in config.
   * @returns The telemetry collector, or null if benchmarking is disabled
   */
  getTelemetry(): TelemetryCollector | null;
}

/**
 * Create a new FuzzyFilter instance
 */
export type CreateFuzzyFilter = (config: FuzzyFilterConfig) => FuzzyFilter;

/**
 * State for React integration
 */
export interface UseFuzzyFilterState {
  query: string;
  suggestions: FilterSuggestion[];
  isLoading: boolean;
  error: Error | null;
  selectedIndex: number;
}

/**
 * Actions for React integration
 */
export interface UseFuzzyFilterActions {
  setQuery: (query: string) => void;
  selectSuggestion: (index: number) => void;
  applySuggestion: () => void;
  navigateSuggestions: (direction: "up" | "down") => void;
  reset: () => void;
}

/**
 * Complete hook return type
 */
export type UseFuzzyFilterReturn = UseFuzzyFilterState & UseFuzzyFilterActions;

/**
 * Events emitted by FuzzyFilter
 */
export type FuzzyFilterEvent =
  | { type: "fieldsChange"; fields: Record<string, FieldSchema<any>> }
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
