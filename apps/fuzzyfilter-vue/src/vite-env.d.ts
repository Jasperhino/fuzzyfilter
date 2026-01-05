/// <reference types="vite/client" />

/**
 * Environment variable declarations for TypeScript.
 */
interface ImportMetaEnv {
  /**
   * Axiom API token for telemetry.
   * Set to enable sending benchmarking events to Axiom.
   */
  readonly VITE_AXIOM_API_KEY?: string;

  /**
   * Axiom dataset name for telemetry.
   * Set to enable sending benchmarking events to Axiom.
   */
  readonly VITE_AXIOM_DATASET?: string;

  /**
   * Optional Axiom API URL (defaults to https://api.axiom.co).
   * Use https://api.eu.axiom.co for EU region.
   */
  readonly VITE_AXIOM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * TypeScript declarations for SVG imports with Vite's ?component transform
 */
declare module "*.svg?component" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >;
  export default component;
}

declare module "lucide-operators/assets/*.svg?component" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >;
  export default component;
}
