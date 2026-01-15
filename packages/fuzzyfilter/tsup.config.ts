import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
  ],
  format: ["esm"],
  dts: true,
  splitting: true,
  clean: true,
  treeshake: true,
  external: ["react", "vue", "i18next", "vue-i18n"],
});
