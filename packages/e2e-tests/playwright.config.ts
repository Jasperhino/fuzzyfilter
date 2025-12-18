import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for fuzzyfilter e2e tests.
 * Tests run against the React and Vue example apps.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Web servers for the example apps
  webServer: [
    {
      command: "bun run dev",
      cwd: "../../example/react-shadcn-vite",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: "bun run dev",
      cwd: "../../example/vue-shadcn-vite",
      port: 5174,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
});
