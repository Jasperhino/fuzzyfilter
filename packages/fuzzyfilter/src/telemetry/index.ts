/**
 * Wide Event Telemetry Module
 *
 * Implements the "Wide Events / Canonical Log Lines" pattern for FuzzyFilter.
 * Each operation emits one comprehensive event with all context needed for debugging.
 *
 * Example usage:
 * ```typescript
 * import { createTelemetryCollector } from "fuzzyfilter/telemetry";
 *
 * const collector = createTelemetryCollector();
 *
 * // Events are emitted as operations complete
 * collector.onEvent((event) => {
 *   console.log(event);
 * });
 *
 * // Query events
 * const suggestEvents = collector.getEventsByOperation("suggest");
 * const summary = collector.getSummary();
 * ```
 *
 * @module fuzzyfilter/telemetry
 */

export {
  createTelemetryCollector,
  NULL_TELEMETRY_COLLECTOR,
} from "./collector.ts";

export type {
  // Core types
  EventOutcome,
  WideEvent,
  WideEventBase,
  WideEventBuilder,
  WideEventCallback,
  TelemetryCollector,
  TelemetryConfig,
  TelemetrySummary,

  // Context types
  SchemaContext,
  DataContext,
  QueryContext,
  SuggestionResultContext,
  IndexingContext,
  ProgressContext,

  // Phase timing types
  IndexDataPhases,
  SuggestPhases,
  StrategyTiming,
  CacheMetrics,
  HistogramStats,

  // Specific event types
  SetSchemaEvent,
  IndexDataEvent,
  SuggestEvent,
  CompileEvent,
  DataMutationEvent,

  // Index progress types
  IndexProgress,
  IndexDataAsyncOptions,
} from "./types.ts";

export { DEFAULT_TELEMETRY_CONFIG } from "./types.ts";
