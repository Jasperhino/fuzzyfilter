/**
 * Wide Event Telemetry Collector
 *
 * Implements the "Wide Events / Canonical Log Lines" pattern.
 * Each operation emits one comprehensive event with all debugging context.
 *
 * @module fuzzyfilter/telemetry/collector
 */

import type {
  WideEvent,
  WideEventBase,
  WideEventBuilder,
  TelemetryConfig,
  TelemetryCollector,
  WideEventCallback,
  EventOutcome,
} from "./types.ts";
import { DEFAULT_TELEMETRY_CONFIG } from "./types.ts";

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// WIDE EVENT BUILDER
// ============================================================================

/**
 * Creates a builder for constructing a wide event during an operation.
 */
function createEventBuilder<T extends WideEvent>(
  operation: T["operation"],
  initialFields: Partial<T>,
  onComplete: (event: T) => void
): WideEventBuilder<T> {
  const startTime = performance.now();

  const event: Partial<T> = {
    event_id: generateEventId(),
    operation,
    ...initialFields,
  } as Partial<T>;

  let completed = false;

  const finalize = (outcome: EventOutcome): T => {
    if (completed) {
      return event as T;
    }
    completed = true;

    const endTime = performance.now();

    (event as WideEventBase).timestamp = new Date().toISOString();
    (event as WideEventBase).duration_ms = Math.round((endTime - startTime) * 100) / 100;
    (event as WideEventBase).outcome = outcome;

    const finalEvent = event as T;
    onComplete(finalEvent);
    return finalEvent;
  };

  return {
    set<K extends keyof T>(key: K, value: T[K]): void {
      if (!completed) {
        event[key] = value;
      }
    },

    merge(fields: Partial<T>): void {
      if (!completed) {
        Object.assign(event, fields);
      }
    },

    recordError(error: Error | string, code?: string): void {
      if (!completed) {
        (event as WideEventBase).error = {
          type: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : error,
          code,
        };
      }
    },

    success(): T {
      return finalize("success");
    },

    error(): T {
      return finalize("error");
    },

    cancel(): T {
      return finalize("cancelled");
    },
  };
}

// ============================================================================
// TELEMETRY COLLECTOR IMPLEMENTATION
// ============================================================================

/**
 * Creates a new Wide Event TelemetryCollector.
 *
 * @example
 * ```typescript
 * const collector = createTelemetryCollector();
 *
 * // Start an event
 * const event = collector.startEvent("suggest", {
 *   query: { text: "status eq", length: 9, token_count: 2 }
 * });
 *
 * // Add context as you process
 * event.set("result", { suggestion_count: 10, top_score: 0.95 });
 *
 * // Complete the event
 * event.success();
 *
 * // Query events later
 * console.log(collector.getEvents());
 * console.log(collector.getSummary());
 * ```
 */
export function createTelemetryCollector(
  userConfig?: Partial<TelemetryConfig>
): TelemetryCollector {
  const config: TelemetryConfig = {
    ...DEFAULT_TELEMETRY_CONFIG,
    ...userConfig,
  };

  const events: WideEvent[] = [];
  const listeners: Set<WideEventCallback> = new Set();

  /**
   * Evicts oldest events if we exceed maxEvents
   */
  function evictOldEvents(): void {
    while (events.length > config.maxEvents) {
      events.shift();
    }
  }

  /**
   * Called when an event completes
   */
  function handleEventComplete(event: WideEvent): void {
    events.push(event);
    evictOldEvents();

    // Notify listeners
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  const collector: TelemetryCollector = {
    get config() {
      return config;
    },

    startEvent<T extends WideEvent>(
      operation: T["operation"],
      initialFields?: Partial<T>
    ): WideEventBuilder<T> {
      if (!config.enabled) {
        // Return a no-op builder
        return createNoOpBuilder<T>(operation);
      }

      return createEventBuilder<T>(
        operation,
        initialFields ?? {},
        handleEventComplete as (event: T) => void
      );
    },

    getEvents(): WideEvent[] {
      return [...events];
    },

    getEventsByOperation<T extends WideEvent>(operation: T["operation"]): T[] {
      return events.filter((e) => e.operation === operation) as T[];
    },

    getEventsSince(timestamp: string | Date): WideEvent[] {
      const since = typeof timestamp === "string" ? timestamp : timestamp.toISOString();
      return events.filter((e) => e.timestamp >= since);
    },

    clear(): void {
      events.length = 0;
    },

    onEvent(callback: WideEventCallback): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    toJSON(): WideEvent[] {
      return [...events];
    },

    getSummary() {
      const eventsByOperation: Record<string, number> = {};
      const eventsByOutcome: Record<EventOutcome, number> = {
        success: 0,
        error: 0,
        cancelled: 0,
      };
      const durationsByOperation: Record<string, number[]> = {};

      for (const event of events) {
        // Count by operation
        eventsByOperation[event.operation] = (eventsByOperation[event.operation] ?? 0) + 1;

        // Count by outcome
        eventsByOutcome[event.outcome]++;

        // Track durations
        if (!durationsByOperation[event.operation]) {
          durationsByOperation[event.operation] = [];
        }
        durationsByOperation[event.operation]!.push(event.duration_ms);
      }

      // Calculate average durations
      const avgDurationByOperation: Record<string, number> = {};
      for (const [op, durations] of Object.entries(durationsByOperation)) {
        const sum = durations.reduce((a, b) => a + b, 0);
        avgDurationByOperation[op] = Math.round((sum / durations.length) * 100) / 100;
      }

      // Calculate error rate
      const errorRate = events.length > 0
        ? Math.round((eventsByOutcome.error / events.length) * 10000) / 100
        : 0;

      return {
        totalEvents: events.length,
        eventsByOperation,
        eventsByOutcome,
        avgDurationByOperation,
        errorRate,
      };
    },
  };

  return collector;
}

/**
 * Creates a no-op event builder for when telemetry is disabled
 */
function createNoOpBuilder<T extends WideEvent>(operation: T["operation"]): WideEventBuilder<T> {
  const noopEvent = { operation, outcome: "success", duration_ms: 0 } as T;

  return {
    set: () => {},
    merge: () => {},
    recordError: () => {},
    success: () => noopEvent,
    error: () => noopEvent,
    cancel: () => noopEvent,
  };
}

// ============================================================================
// NULL COLLECTOR (for when benchmarking is disabled)
// ============================================================================

/**
 * A no-op telemetry collector that does nothing.
 * Used when benchmarking is disabled to avoid any overhead.
 */
export const NULL_TELEMETRY_COLLECTOR: TelemetryCollector = {
  config: { ...DEFAULT_TELEMETRY_CONFIG, enabled: false },

  startEvent<T extends WideEvent>(operation: T["operation"]): WideEventBuilder<T> {
    return createNoOpBuilder<T>(operation);
  },

  getEvents: () => [],
  getEventsByOperation: () => [],
  getEventsSince: () => [],
  clear: () => {},
  onEvent: () => () => {},
  toJSON: () => [],
  getSummary: () => ({
    totalEvents: 0,
    eventsByOperation: {},
    eventsByOutcome: { success: 0, error: 0, cancelled: 0 },
    avgDurationByOperation: {},
    errorRate: 0,
  }),
};
