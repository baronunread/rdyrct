import { defineConfig, devices } from "@playwright/test";
import { selfHostPort, selfHostUrl } from "./tests/e2e/environment";

/**
 * Shares dist/ with playwright.production.config.ts's build, so the two never run at once. Runs on .dev.vars.self-host
 * (no email, Polar or Google, as a fork first comes up): the command replaces the .dev.vars copy `vite preview` reads.
 */
export default defineConfig({
  testDir: "./tests/e2e/self-host",
  testMatch: "**/*.pw.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 2,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.CI ? "chrome" : undefined,
    baseURL: selfHostUrl,
  },
  webServer: {
    command: `bun run build && cp .dev.vars.self-host dist/rdyrct/.dev.vars && bunx vite preview --port ${selfHostPort} --strictPort`,
    url: `${selfHostUrl}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
    env: { PLAYWRIGHT_TEST: "1", VITE_RDYRCT_SITE: "0" },
  },
});
