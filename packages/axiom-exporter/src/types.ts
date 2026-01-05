/**
 * Axiom Exporter Types
 *
 * Configuration and type definitions for the Axiom telemetry exporter.
 *
 * @module @fuzzyfilter/axiom-exporter/types
 */

/**
 * Configuration options for the Axiom exporter.
 */
export interface AxiomExporterConfig {
  /**
   * Axiom API token.
   * Generate at https://app.axiom.co/settings/api-tokens with `Ingest` permission.
   */
  apiToken: string;

  /**
   * Axiom dataset name to ingest events into.
   * Create via CLI: `axiom dataset create -n your-dataset-name`
   */
  dataset: string;

  /**
   * Optional service name to attach to all events.
   * Useful for distinguishing between different apps/environments.
   */
  serviceName?: string;

  /**
   * Optional environment tag (e.g., 'development', 'staging', 'production').
   */
  environment?: string;

  /**
   * Optional Axiom API URL.
   * Defaults to 'https://api.axiom.co' for US region.
   * Use 'https://api.eu.axiom.co' for EU region.
   */
  apiUrl?: string;

  /**
   * Error callback for failed ingestion attempts.
   * Defaults to console.error.
   */
  onError?: (error: Error) => void;
}

/**
 * The Axiom exporter instance.
 */
export interface AxiomExporter {
  /**
   * Attach the exporter to a telemetry collector.
   * Events emitted by the collector will be forwarded to Axiom.
   *
   * @param collector - The telemetry collector to attach to
   */
  attach(collector: TelemetryCollectorLike): void;

  /**
   * Detach the exporter from the telemetry collector.
   * Stops forwarding events to Axiom.
   */
  detach(): void;

  /**
   * Flush any buffered events to Axiom.
   * Call this before your app exits to ensure all events are sent.
   *
   * @returns Promise that resolves when flush is complete
   */
  flush(): Promise<void>;

  /**
   * Check if the exporter is currently attached to a collector.
   */
  readonly isAttached: boolean;
}

/**
 * Minimal interface for TelemetryCollector compatibility.
 * Allows the exporter to work without a direct dependency on fuzzyfilter types.
 */
export interface TelemetryCollectorLike {
  /**
   * Subscribe to telemetry events.
   *
   * @param callback - Function called when an event is emitted
   * @returns Unsubscribe function
   */
  onEvent(callback: (event: WideEventLike) => void): () => void;
}

/**
 * Minimal interface for WideEvent compatibility.
 * Represents a structured telemetry event from FuzzyFilter.
 */
export interface WideEventLike {
  /** Unique event ID */
  event_id: string;

  /** ISO timestamp when event was emitted */
  timestamp: string;

  /** Operation name (e.g., "indexData", "suggest", "compile") */
  operation: string;

  /** Duration in milliseconds */
  duration_ms: number;

  /** Outcome of the operation */
  outcome: "success" | "error" | "cancelled";

  /** Additional event data (operation-specific) */
  [key: string]: unknown;
}
