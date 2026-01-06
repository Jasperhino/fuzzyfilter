import path from "node:path"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import tailwindcss from "@tailwindcss/vite"
import svgLoader from "vite-svg-loader"

const packagesPath = path.resolve(__dirname, "../../packages")

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    svgLoader({
      defaultImport: "component",
      svgoConfig: {
        plugins: [
          {
            name: "preset-default",
            params: {
              overrides: {
                // Preserve viewBox for proper CSS scaling
                removeViewBox: false,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Resolve local packages
      "@jasperhino/fuzzyfilter": path.resolve(packagesPath, "fuzzyfilter/src/index.ts"),
      "fuzzyfilter": path.resolve(packagesPath, "fuzzyfilter/src/index.ts"),
      "fuzzyfilter/i18n/locales": path.resolve(packagesPath, "fuzzyfilter/src/i18n/locales/index.ts"),
      "fuzzyfilter/types/i18n": path.resolve(packagesPath, "fuzzyfilter/src/types/i18n.ts"),
      "fuzzyfilter-vue": path.resolve(packagesPath, "fuzzyfilter-vue/src/index.ts"),
      "@fuzzyfilter/sample-data": path.resolve(packagesPath, "sample-data/src/index.ts"),
      "@fuzzyfilter/i18n-locales": path.resolve(packagesPath, "i18n-locales/src/index.ts"),
      // Resolve lucide-operators packages
      "lucide-operators/assets": path.resolve(packagesPath, "lucide-operators/assets"),
      "lucide-operators": path.resolve(packagesPath, "lucide-operators/src/index.ts"),
      "lucide-operators-vue": path.resolve(packagesPath, "lucide-operators-vue/src/index.ts"),
      // Resolve axiom-exporter package
      "@fuzzyfilter/axiom-exporter": path.resolve(packagesPath, "axiom-exporter/src/index.ts"),
    },
  },
  server: {
    port: 5174,
    watch: {
      // Watch packages for hot reloading
      ignored: [`!${packagesPath}/**`],
    },
  },
  // Pre-bundle fuzzyfilter dependencies
  optimizeDeps: {
    include: ["fuzzysort", "chrono-node"],
    exclude: ["fuzzyfilter", "fuzzyfilter-vue", "@fuzzyfilter/sample-data", "@fuzzyfilter/i18n-locales", "lucide-operators", "@fuzzyfilter/axiom-exporter"],
  },
})
