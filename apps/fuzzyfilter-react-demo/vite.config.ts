import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import svgr from "vite-plugin-svgr"
import { defineConfig } from "vite"

const packagesPath = path.resolve(__dirname, "../../packages")

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    svgr({
      svgrOptions: {
        // Ensure SVGs work with currentColor
        svgoConfig: {
          plugins: [
            {
              name: "preset-default",
              params: {
                overrides: {
                  removeViewBox: false,
                },
              },
            },
          ],
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@jasperhino/fuzzyfilter": path.resolve(packagesPath, "fuzzyfilter/src/index.ts"),
      "fuzzyfilter": path.resolve(packagesPath, "fuzzyfilter/src/index.ts"),
      "fuzzyfilter/i18n/adapters": path.resolve(packagesPath, "fuzzyfilter/src/i18n/adapters/index.ts"),
      "fuzzyfilter/i18n/adapters/i18next": path.resolve(packagesPath, "fuzzyfilter/src/i18n/adapters/i18next.ts"),
      "fuzzyfilter/i18n/adapters/vue-i18n": path.resolve(packagesPath, "fuzzyfilter/src/i18n/adapters/vue-i18n.ts"),
      "fuzzyfilter/types/i18n": path.resolve(packagesPath, "fuzzyfilter/src/types/i18n.ts"),
      "fuzzyfilter-react": path.resolve(packagesPath, "fuzzyfilter-react/src/index.ts"),
      "@fuzzyfilter/sample-data": path.resolve(packagesPath, "sample-data/src/index.ts"),
      "@fuzzyfilter/i18n-locales": path.resolve(packagesPath, "i18n-locales/src/index.ts"),
      "lucide-operators/assets": path.resolve(packagesPath, "lucide-operators/assets"),
      "lucide-operators": path.resolve(packagesPath, "lucide-operators/src/index.ts"),
      "lucide-operators-react": path.resolve(packagesPath, "lucide-operators-react/src/index.tsx"),
      "@fuzzyfilter/axiom-exporter": path.resolve(packagesPath, "axiom-exporter/src/index.ts"),
    },
    // Ensure React is always resolved from the project root
    // This is needed for SVG imports via vite-plugin-svgr from workspace packages
    dedupe: ["react", "react-dom"],
  },
  // Watch the library source for hot reloading
  server: {
    port: 5173,
    watch: {
      // Watch the packages folder for changes
      ignored: [`!${packagesPath}/**`],
    },
  },
  // Exclude local packages from optimization so changes are picked up
  optimizeDeps: {
    include: ["fuzzysort", "chrono-node"],
    exclude: ["fuzzyfilter", "fuzzyfilter-react", "@fuzzyfilter/sample-data", "@fuzzyfilter/i18n-locales", "lucide-operators", "lucide-operators-react", "@fuzzyfilter/axiom-exporter"],
  },
})
