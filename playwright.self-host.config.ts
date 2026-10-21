import { defineConfig, devices } from "@playwright/test";
import { selfHostPort, selfHostUrl } from "./tests/e2e/environment";

/**
 * The build a fork deploys: no landing page, no pricing, no rdyrct.com
 * analytics. Its own config because it needs its own build, and that build
 * writes to the same dist/ as playwright.config.ts's production preview, so
 * the two never run at once.
 *
 *   bun run e2e:self-host
 */
export default defineConfig({
  testDir: "./tests/e2e/self-host",
  testMatch: "**/*.pw.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.CI ? "chrome" : undefined,
    baseURL: selfHostUrl,
  },
  webServer: {
    command: `bun run build && bunx vite preview --port ${selfHostPort} --strictPort`,
    url: `${selfHostUrl}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
    env: { PLAYWRIGHT_TEST: "1", VITE_RDYRCT_SITE: "0" },
  },
});
