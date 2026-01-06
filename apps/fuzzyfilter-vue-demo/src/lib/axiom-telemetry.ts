/**
 * Axiom Telemetry Integration
 *
 * Optionally enables Axiom telemetry for FuzzyFilter benchmarking.
 * Set VITE_AXIOM_API_KEY and VITE_AXIOM_DATASET environment variables to enable.
 *
 * @module axiom-telemetry
 */

import { createAxiomExporter, type AxiomExporter } from "@fuzzyfilter/axiom-exporter";
import type { TelemetryCollector } from "@jasperhino/fuzzyfilter";

/**
 * Axiom configuration from environment variables.
 */
interface AxiomConfig {
  token: string;
  dataset: string;
  apiUrl?: string;
}

/**
 * Singleton exporter instance.
 */
let exporterInstance: AxiomExporter | null = null;

/**
 * Gets Axiom configuration from environment variables.
 *
 * @returns Axiom config if all required variables are set, null otherwise
 */
function getAxiomConfig(): AxiomConfig | null {
  const token = import.meta.env.VITE_AXIOM_API_KEY;
  const dataset = import.meta.env.VITE_AXIOM_DATASET;

  if (!token || !dataset) {
    return null;
  }

  return {
    token,
    dataset,
    apiUrl: import.meta.env.VITE_AXIOM_URL,
  };
}

/**
 * Creates and attaches an Axiom exporter to the given telemetry collector.
 * Only creates the exporter if Axiom environment variables are configured.
 *
 * @param telemetry - The telemetry collector to attach to
 * @returns The exporter instance if created, null otherwise
 */
export function attachAxiomExporter(telemetry: TelemetryCollector | null): AxiomExporter | null {
  if (!telemetry) {
    return null;
  }

  const config = getAxiomConfig();
  if (!config) {
    console.debug("[Axiom] Telemetry not enabled. Set VITE_AXIOM_API_KEY and VITE_AXIOM_DATASET to enable.");
    return null;
  }

  // Reuse existing instance if already created
  if (exporterInstance) {
    return exporterInstance;
  }

  try {
    exporterInstance = createAxiomExporter({
      apiToken: config.token,
      dataset: config.dataset,
      apiUrl: config.apiUrl,
      serviceName: "fuzzyfilter-vue-demo",
      environment: import.meta.env.MODE,
      onError: (error) => {
        console.error("[Axiom] Telemetry error:", error);
      },
    });

    exporterInstance.attach(telemetry);
    console.info(`[Axiom] Telemetry enabled. Events will be sent to dataset: ${config.dataset}`);

    return exporterInstance;
  } catch (error) {
    console.error("[Axiom] Failed to create exporter:", error);
    return null;
  }
}

/**
 * Flushes any buffered events to Axiom.
 * Call before app exit to ensure all events are sent.
 */
export async function flushAxiomEvents(): Promise<void> {
  if (exporterInstance) {
    await exporterInstance.flush();
  }
}

/**
 * Check if Axiom telemetry is enabled.
 */
export function isAxiomEnabled(): boolean {
  return getAxiomConfig() !== null;
}
