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
 * TypeScript declarations for SVG imports with vite-plugin-svgr's ?react transform
 */
declare module "*.svg?react" {
  import type { FC, SVGProps } from "react";
  const content: FC<SVGProps<SVGSVGElement>>;
  export default content;
}

declare module "lucide-operators/assets/*.svg?react" {
  import type { FC, SVGProps } from "react";
  const content: FC<SVGProps<SVGSVGElement>>;
  export default content;
}
