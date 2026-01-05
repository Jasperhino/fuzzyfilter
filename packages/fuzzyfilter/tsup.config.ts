import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/i18n/locales/index.ts",
    "src/i18n/adapters/index.ts",
    "src/i18n/adapters/i18next.ts",
    "src/i18n/adapters/vue-i18n.ts",
    "src/types/i18n.ts",
  ],
  format: ["esm"],
  dts: true,
  splitting: true,
  clean: true,
  treeshake: true,
  external: ["react", "vue", "i18next", "vue-i18n"],
});
