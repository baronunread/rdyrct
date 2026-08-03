import { defineConfig, devices } from "@playwright/test";
import { appUrl, playwrightPort } from "./tests/e2e/environment";

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
      use: {
        ...devices["Desktop Chrome"],
        // CI runners ship Google Chrome preinstalled: launch that instead of
        // downloading Playwright's own Chromium build. Local dev keeps using
        // the bundled build from `bun run e2e:install`.
        channel: process.env.CI ? "chrome" : undefined,
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
  ],
});
