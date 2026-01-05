/**
 * @fuzzyfilter/axiom-exporter
 *
 * Export FuzzyFilter telemetry events to Axiom for benchmarking and analysis.
 *
 * @example
 * ```typescript
 * import { createFuzzyFilter } from 'fuzzyfilter';
 * import { createAxiomExporter } from '@fuzzyfilter/axiom-exporter';
 *
 * // Create exporter
 * const exporter = createAxiomExporter({
 *   apiToken: process.env.AXIOM_TOKEN!,
 *   dataset: 'fuzzyfilter-benchmarks',
 *   serviceName: 'my-app',
 *   environment: 'production',
 * });
 *
 * // Create filter with benchmarking enabled
 * const filter = createFuzzyFilter({ benchmark: true });
 *
 * // Attach exporter to telemetry collector
 * const telemetry = filter.getTelemetry();
 * if (telemetry) {
 *   exporter.attach(telemetry);
 * }
 *
 * // Use filter normally - events are automatically sent to Axiom
 * ```
 *
 * @module @fuzzyfilter/axiom-exporter
 */

export { createAxiomExporter } from "./axiom-exporter.ts";

export type {
  AxiomExporterConfig,
  AxiomExporter,
  TelemetryCollectorLike,
  WideEventLike,
} from "./types.ts";
