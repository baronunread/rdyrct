import { defineConfig, devices } from "@playwright/test";
import { appUrl, BUILD_ENV, playwrightPort } from "./tests/e2e/environment";
import { shardFiles } from "./tests/e2e/shards";

// CI shards are balanced on each file's duration, not test counts: see tests/e2e/shards.ts.
const shard = process.env.E2E_SHARD;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.pw.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  // Pinned: 4 workers on the one `vite dev` server made each test ~1.75x slower and let races through that 2 never hit.
  // Local runs and CI shards then match.
  workers: 2,
  // Playwright's 30s default is short for multi-account flows (downgrade, link import, domains: ~25s idle). A loaded
  // machine or a first-request route compile can double that, and a timeout there says nothing about the feature.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "e2e-timings/report.json" }]]
    : "list",
  use: {
    baseURL: appUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: ["**/production/**", "**/self-host/**"],
      testMatch: shard
        ? shardFiles("tests/e2e", shard).map((name) => `**/tests/e2e/${name}`)
        : "**/*.pw.ts",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? "chrome" : undefined,
      },
    },
  ],
  webServer: [
    {
      // resend on 4000, google OAuth on 4001 (GOOGLE_EMULATOR_URL in .dev.vars.playwright).
      command: "bunx emulate --service resend,google",
      url: "http://127.0.0.1:4000/emails",
      reuseExistingServer: !process.env.CI,
      gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
    },
    {
      command: `bunx vite dev --host localhost --port ${playwrightPort} --strictPort`,
      url: appUrl,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
      env: { ...BUILD_ENV, CLOUDFLARE_ENV: "playwright" },
    },
  ],
});
