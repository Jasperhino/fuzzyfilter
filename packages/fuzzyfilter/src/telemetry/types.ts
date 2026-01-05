/**
 * Wide Event Telemetry Types
 *
 * Implements the "Wide Events / Canonical Log Lines" pattern for FuzzyFilter.
 * Each operation emits one comprehensive event with all context needed for debugging.
 *
 * @module fuzzyfilter/telemetry/types
 */

// ============================================================================
// WIDE EVENT TYPES
// ============================================================================

/**
 * Outcome of an operation
 */
export type EventOutcome = "success" | "error" | "cancelled";

/**
 * Base fields present in all wide events
 */
export interface WideEventBase {
  /** Unique event ID */
  event_id: string;

  /** ISO timestamp when event was emitted */
  timestamp: string;

  /** Operation name (e.g., "indexData", "suggest", "compile") */
  operation: string;

  /** Duration in milliseconds */
  duration_ms: number;

  /** Outcome of the operation */
  outcome: EventOutcome;

  /** Error details if outcome is "error" */
  error?: {
    type: string;
    message: string;
    code?: string;
  };
}

/**
 * Schema context - current state of the schema
 */
export interface SchemaContext {
  column_count: number;
  column_types: Record<string, number>; // e.g., { enum: 2, string: 3, number: 1 }
}

/**
 * Data context - current state of indexed data
 */
export interface DataContext {
  row_count: number;
  unique_values: number;
  data_version: number;
}

/**
 * Query context - details about a suggest query
 */
export interface QueryContext {
  text: string;
  length: number;
  token_count: number;
  cursor_position?: number;
  filter_context_count: number;
}

/**
 * Suggestion result context
 */
export interface SuggestionResultContext {
  suggestion_count: number;
  top_score: number | null;
  has_complete_match: boolean;
  categories: Record<string, number>; // e.g., { column_operator_value: 5, column_operator: 3 }
}

/**
 * Indexing context - details about an indexing operation
 */
export interface IndexingContext {
  row_count: number;
  chunk_size?: number;
  chunk_count?: number;
  is_async: boolean;
}

/**
 * Progress context for async operations
 */
export interface ProgressContext {
  processed: number;
  total: number;
  percentage: number;
  current_chunk: number;
  total_chunks: number;
}

// ============================================================================
// SPECIFIC WIDE EVENT TYPES
// ============================================================================

/**
 * Wide event for setSchema operation
 */
export interface SetSchemaEvent extends WideEventBase {
  operation: "setSchema";
  schema: SchemaContext;
  had_existing_data: boolean;
  triggered_reindex: boolean;
}

/**
 * Wide event for indexData operation
 */
export interface IndexDataEvent extends WideEventBase {
  operation: "indexData" | "indexDataAsync";
  indexing: IndexingContext;
  result: {
    columns_indexed: number;
    unique_values: number;
  };
  progress?: ProgressContext;
}

/**
 * Wide event for suggest operation
 */
export interface SuggestEvent extends WideEventBase {
  operation: "suggest";
  query: QueryContext;
  schema: SchemaContext;
  data: DataContext;
  result: SuggestionResultContext;
}

/**
 * Wide event for compile operation
 */
export interface CompileEvent extends WideEventBase {
  operation: "compile" | "compileFilter";
  input: {
    type: "string" | "structured";
    column_id?: string;
    operator?: string;
    has_value: boolean;
  };
  result: {
    success: boolean;
    column_type?: string;
  };
}

/**
 * Wide event for data mutation operations
 */
export interface DataMutationEvent extends WideEventBase {
  operation: "addRow" | "removeRow" | "removeRows";
  mutation: {
    rows_affected: number;
    previous_row_count: number;
    new_row_count: number;
  };
}

/**
 * Union of all wide event types
 */
export type WideEvent =
  | SetSchemaEvent
  | IndexDataEvent
  | SuggestEvent
  | CompileEvent
  | DataMutationEvent;

// ============================================================================
// TELEMETRY CONFIGURATION
// ============================================================================

/**
 * Configuration options for the telemetry collector.
 */
export interface TelemetryConfig {
  /** Whether telemetry collection is enabled */
  enabled: boolean;

  /** Maximum number of events to retain (oldest are evicted first) */
  maxEvents: number;

  /** Whether to include query text in events (may contain sensitive data) */
  captureQueryText: boolean;
}

/**
 * Default telemetry configuration
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: true,
  maxEvents: 1000,
  captureQueryText: true,
};

// ============================================================================
// TELEMETRY COLLECTOR INTERFACE
// ============================================================================

/**
 * Callback for wide event emission
 */
export type WideEventCallback = (event: WideEvent) => void;

/**
 * Builder for constructing a wide event during an operation
 */
export interface WideEventBuilder<T extends WideEvent = WideEvent> {
  /** Set a field on the event */
  set<K extends keyof T>(key: K, value: T[K]): void;

  /** Merge multiple fields at once */
  merge(fields: Partial<T>): void;

  /** Record an error */
  recordError(error: Error | string, code?: string): void;

  /** Complete the event with success outcome */
  success(): T;

  /** Complete the event with error outcome */
  error(): T;

  /** Complete the event with cancelled outcome */
  cancel(): T;
}

/**
 * The TelemetryCollector manages wide event creation and storage.
 */
export interface TelemetryCollector {
  /** Current configuration */
  readonly config: TelemetryConfig;

  /**
   * Start building a wide event for an operation.
   * Call success(), error(), or cancel() on the builder when done.
   */
  startEvent<T extends WideEvent>(
    operation: T["operation"],
    initialFields?: Partial<T>
  ): WideEventBuilder<T>;

  /**
   * Get all collected events.
   */
  getEvents(): WideEvent[];

  /**
   * Get events filtered by operation type.
   */
  getEventsByOperation<T extends WideEvent>(
    operation: T["operation"]
  ): T[];

  /**
   * Get events within a time range.
   */
  getEventsSince(timestamp: string | Date): WideEvent[];

  /**
   * Clear all collected events.
   */
  clear(): void;

  /**
   * Subscribe to new events.
   */
  onEvent(callback: WideEventCallback): () => void;

  /**
   * Export events as JSON-serializable array.
   */
  toJSON(): WideEvent[];

  /**
   * Get summary statistics across all events.
   */
  getSummary(): {
    totalEvents: number;
    eventsByOperation: Record<string, number>;
    eventsByOutcome: Record<EventOutcome, number>;
    avgDurationByOperation: Record<string, number>;
    errorRate: number;
  };
}

// ============================================================================
// INDEX PROGRESS TYPES (for async operations)
// ============================================================================

/**
 * Progress information for async indexing operations.
 */
export interface IndexProgress {
  /** Number of rows processed so far */
  processed: number;

  /** Total number of rows to process */
  total: number;

  /** Percentage complete (0-100) */
  percentage: number;

  /** Current chunk number (1-based) */
  currentChunk: number;

  /** Total number of chunks */
  totalChunks: number;

  /** Estimated time remaining in milliseconds */
  estimatedTimeRemainingMs?: number;
}

/**
 * Options for async indexing
 */
export interface IndexDataAsyncOptions {
  /** Number of rows to process per chunk (default: 100) */
  chunkSize?: number;

  /** Progress callback called after each chunk */
  onProgress?: (progress: IndexProgress) => void;

  /** AbortSignal to cancel the operation */
  signal?: AbortSignal;
}
