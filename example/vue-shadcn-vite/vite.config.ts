import path from "node:path"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import tailwindcss from "@tailwindcss/vite"

const packagesPath = path.resolve(__dirname, "../../packages")

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Resolve local packages
      "fuzzyfilter": path.resolve(packagesPath, "fuzzyfilter/src/index.ts"),
      "vue-fuzzy-filter": path.resolve(packagesPath, "vue-fuzzy-filter/src/index.ts"),
      "@fuzzyfilter/sample-data": path.resolve(packagesPath, "sample-data/src/index.ts"),
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
    exclude: ["fuzzyfilter", "vue-fuzzy-filter", "@fuzzyfilter/sample-data"],
  },
})
