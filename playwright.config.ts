import { defineConfig, devices } from "@playwright/test";
import { appUrl, playwrightPort, previewPort, previewUrl } from "./tests/e2e/environment";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.pw.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: appUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // The production suite has its own base URL and server; everything else
      // runs against `vite dev`.
      testIgnore: "**/production/**",
      use: {
        ...devices["Desktop Chrome"],
        // CI runners ship Google Chrome preinstalled: launch that instead of
        // downloading Playwright's own Chromium build. Local dev keeps using
        // the bundled build from `bun run e2e:install`.
        channel: process.env.CI ? "chrome" : undefined,
      },
    },
    {
      // Runs against the built worker and assets, where the real
      // Content-Security-Policy applies. See tests/e2e/production/csp.pw.ts.
      name: "production",
      testDir: "./tests/e2e/production",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? "chrome" : undefined,
        baseURL: previewUrl,
      },
    },
  ],
  webServer: [
    {
      command: "bunx emulate --service resend",
      url: "http://127.0.0.1:4000/emails",
      reuseExistingServer: !process.env.CI,
      gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
    },
    {
      command: `bunx vite dev --host localhost --port ${playwrightPort} --strictPort`,
      url: appUrl,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
      env: {
        PLAYWRIGHT_TEST: "1",
        CLOUDFLARE_ENV: "playwright",
      },
    },
    {
      // Built output, not the dev server: `vite dev` relaxes script-src for
      // Vite's inline React Refresh preamble, so only this one serves the
      // policy that actually ships. The build is part of the command so the
      // suite can never assert against a stale dist/.
      command: `bunx vite build && bunx vite preview --port ${previewPort} --strictPort`,
      url: previewUrl,
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
      env: {
        PLAYWRIGHT_TEST: "1",
        CLOUDFLARE_ENV: "playwright",
      },
    },
  ],
});
