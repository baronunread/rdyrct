import { defineConfig, devices } from "@playwright/test";
import { BUILD_ENV, previewPort, previewUrl } from "./tests/e2e/environment";

/**
 * Where the real CSP applies: `vite dev` relaxes script-src for React Refresh. Shares dist/ with
 * playwright.self-host.config.ts's build, so the two never run at once.
 */
export default defineConfig({
  testDir: "./tests/e2e/production",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.CI ? "chrome" : undefined,
    baseURL: previewUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // The build is in the command so the suite never asserts against a stale dist/. It copies .dev.vars into dist/rdyrct/,
    // which `vite preview` reads, so that copy is replaced with the test values. APP_HOST is pinned to the preview's host
    // (a later line wins): the CSP allows Turnstile only on APP_HOST.
    command: `bun run build && cp .dev.vars.playwright dist/rdyrct/.dev.vars && printf '\\nAPP_HOST=localhost:${previewPort}\\nAPP_URL=${previewUrl}\\n' >> dist/rdyrct/.dev.vars && bunx vite preview --port ${previewPort} --strictPort`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
    // No CLOUDFLARE_ENV: the built wrangler.json has no `playwright` environment, so setting it only warns.
    env: BUILD_ENV,
  },
});
