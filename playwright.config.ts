import { defineConfig, devices } from "@playwright/test";
import { appUrl, BUILD_ENV, playwrightPort } from "./tests/e2e/environment";
import { shardFiles } from "./tests/e2e/shards";

// CI runs one shard per job, balanced on each file's duration rather than
// Playwright's equal test counts: see tests/e2e/shards.ts.
const shard = process.env.E2E_SHARD;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.pw.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  // Playwright defaults to half the machine's cores, which is 2 on a CI runner
  // and 4 or more on a dev machine. Every worker talks to the same single
  // Miniflare dev server, so the extra ones only queue behind each other:
  // tests that pass in CI time out locally, and the whole suite runs slower
  // (1.6m at 4 workers, 1.3m at 2). Pinned so both match.
  workers: 2,
  // Playwright's default is 30s, which was set for tests that click around a
  // page. Nearly every test here starts by creating a real account: a Turnstile
  // challenge, an account write, a mail send and a six-digit code
  // read back out of the emulator. That is most of 30s before the test has
  // begun, and it is why failures kept landing on the first assertion after
  // sign-up rather than on anything the test was written to check.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The JSON report is the per-file durations the shards are balanced on.
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
      // The production and self-host suites have their own configs, each
      // with a build of its own; everything here runs against `vite dev`.
      testIgnore: ["**/production/**", "**/self-host/**"],
      testMatch: shard
        ? shardFiles("tests/e2e", shard).map((name) => `**/tests/e2e/${name}`)
        : "**/*.pw.ts",
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
      // resend on 4000, google OAuth on 4001 (see GOOGLE_EMULATOR_URL in
      // .dev.vars.playwright). One process, so one webServer entry.
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
