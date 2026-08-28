import { defineConfig, devices } from "@playwright/test";
import { appUrl, playwrightPort, previewPort, previewUrl } from "./tests/e2e/environment";

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
  // page. Nearly every test here starts by creating a real account: a Cap
  // proof-of-work solve, an account write, a mail send and a six-digit code
  // read back out of the emulator. That is most of 30s before the test has
  // begun, and it is why failures kept landing on the first assertion after
  // sign-up rather than on anything the test was written to check.
  timeout: 60_000,
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
      // No CLOUDFLARE_ENV here: the built wrangler.json carries no
      // `playwright` environment, so setting it only produces a warning.
      // These tests are about response headers and need no backend state.
      env: {
        PLAYWRIGHT_TEST: "1",
      },
    },
  ],
});
