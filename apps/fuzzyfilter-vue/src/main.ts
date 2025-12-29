import { createApp } from "vue"
import "./style.css"
import DemoPage from "./components/DemoPage.vue"
import { tryLoadAndStartRecorder } from "@alwaysmeticulous/recorder-loader"

/**
 * Checks if the current environment is production.
 * @returns True if running on the production hostname, false otherwise.
 */
function isProduction(): boolean {
  // TODO: Update with your production hostname
  return window.location.hostname.indexOf("your-production-site.com") > -1
}

/**
 * Initializes the Meticulous recorder (if not in production) and starts the Vue app.
 */
async function startApp(): Promise<void> {
  // Record all sessions on localhost, staging stacks and preview URLs
  if (!isProduction()) {
    // Start the Meticulous recorder before initializing your app.
    // Note: all errors are caught and logged, so no need to surround with try/catch
    await tryLoadAndStartRecorder({
      recordingToken: "ldtob0kNLhX9bbdzwIXwUUNtWCYDkbXU6WYj1sir",
      isProduction: false,
    })
  }

  // Initialize app after the Meticulous recorder is ready
  const app = createApp(DemoPage)
  app.mount("#app")
}

startApp()
