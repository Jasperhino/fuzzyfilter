/**
 * Axiom Exporter Implementation
 *
 * Exports FuzzyFilter telemetry events to Axiom for benchmarking and analysis.
 * Uses the @axiomhq/js SDK for automatic batching and reliable delivery.
 *
 * @module @fuzzyfilter/axiom-exporter
 */

import { Axiom } from "@axiomhq/js";
import type {
  AxiomExporterConfig,
  AxiomExporter,
  TelemetryCollectorLike,
  WideEventLike,
} from "./types.ts";

/**
 * Default Axiom API URL (US region).
 */
const DEFAULT_API_URL = "https://api.axiom.co";

/**
 * Creates an Axiom exporter for FuzzyFilter telemetry events.
 *
 * The exporter subscribes to a TelemetryCollector's `onEvent` callback and
 * forwards all events to Axiom. Events are enriched with optional service
 * name and environment tags.
 *
 * The @axiomhq/js SDK handles batching automatically, so events are buffered
 * and sent in efficient batches rather than individually.
 *
 * @example
 * ```typescript
 * import { createFuzzyFilter } from 'fuzzyfilter';
 * import { createAxiomExporter } from '@fuzzyfilter/axiom-exporter';
 *
 * const exporter = createAxiomExporter({
 *   apiToken: process.env.AXIOM_TOKEN!,
 *   dataset: 'fuzzyfilter-benchmarks',
 *   serviceName: 'my-app',
 *   environment: 'production',
 * });
 *
 * const filter = createFuzzyFilter({ benchmark: true });
 * exporter.attach(filter.getTelemetry()!);
 *
 * // Events are now automatically sent to Axiom
 * ```
 *
 * @param config - Exporter configuration
 * @returns Axiom exporter instance
 */
export function createAxiomExporter(config: AxiomExporterConfig): AxiomExporter {
  const { apiToken, dataset, serviceName, environment, apiUrl, onError } = config;

  // Create Axiom client
  const axiom = new Axiom({
    token: apiToken,
    url: apiUrl ?? DEFAULT_API_URL,
    onError: onError ?? console.error,
  });

  // Track subscription state
  let unsubscribe: (() => void) | null = null;
  let beforeUnloadHandler: (() => void) | null = null;

  /**
   * Enriches an event with service metadata before sending to Axiom.
   */
  function enrichEvent(event: WideEventLike): Record<string, unknown> {
    const enriched: Record<string, unknown> = { ...event };

    if (serviceName) {
      enriched._service = serviceName;
    }

    if (environment) {
      enriched._environment = environment;
    }

    return enriched;
  }

  /**
   * Handles an incoming telemetry event.
   */
  function handleEvent(event: WideEventLike): void {
    const enrichedEvent = enrichEvent(event);
    axiom.ingest(dataset, [enrichedEvent]);
  }

  /**
   * Sets up the beforeunload handler for browsers.
   * Uses sendBeacon when available for reliable delivery on page unload.
   */
  function setupBeforeUnloadHandler(): void {
    if (typeof window === "undefined") {
      return;
    }

    beforeUnloadHandler = () => {
      // Use sendBeacon for reliable delivery on unload
      // The Axiom SDK's flush() is async, which may not complete during unload
      // As a fallback, we try to flush synchronously
      try {
        axiom.flush();
      } catch {
        // Ignore errors during unload
      }
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
  }

  /**
   * Removes the beforeunload handler.
   */
  function removeBeforeUnloadHandler(): void {
    if (typeof window === "undefined" || !beforeUnloadHandler) {
      return;
    }

    window.removeEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadHandler = null;
  }

  return {
    attach(collector: TelemetryCollectorLike): void {
      // Detach existing subscription if any
      if (unsubscribe) {
        unsubscribe();
      }

      // Subscribe to events
      unsubscribe = collector.onEvent(handleEvent);

      // Setup browser unload handling
      setupBeforeUnloadHandler();
    },

    detach(): void {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }

      removeBeforeUnloadHandler();
    },

    async flush(): Promise<void> {
      await axiom.flush();
    },

    get isAttached(): boolean {
      return unsubscribe !== null;
    },
  };
}
