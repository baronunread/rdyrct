import { defineConfig, devices } from "@playwright/test";
import { BUILD_ENV, previewPort, previewUrl } from "./tests/e2e/environment";

/**
 * The built worker and assets, where the real Content-Security-Policy
 * applies: `vite dev` relaxes script-src for Vite's inline React Refresh
 * preamble, so only a build serves the policy that actually ships. See
 * tests/e2e/production/csp.pw.ts.
 *
 *   bun run e2e:production
 *
 * Its own config because it needs its own build: in playwright.config.ts
 * the build ran on every run, even one spec against `vite dev`, and on
 * every CI shard. That build writes to the same dist/ as
 * playwright.self-host.config.ts's, so the two never run at once.
 */
export default defineConfig({
  testDir: "./tests/e2e/production",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  // Header and page checks against one server, no sign-ups.
  workers: 2,
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
    // The build is part of the command so the suite can never assert against
    // a stale dist/. The build copies whatever .dev.vars it finds into
    // dist/rdyrct/, and that copy is the one `vite preview` reads, so it is
    // replaced with the test values. APP_HOST is then pinned to the
    // preview's own host (a later line wins): the CSP only allows Turnstile
    // on APP_HOST.
    command: `bun run build && cp .dev.vars.playwright dist/rdyrct/.dev.vars && printf '\\nAPP_HOST=localhost:${previewPort}\\nAPP_URL=${previewUrl}\\n' >> dist/rdyrct/.dev.vars && bunx vite preview --port ${previewPort} --strictPort`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
    // No CLOUDFLARE_ENV here: the built wrangler.json carries no
    // `playwright` environment, so setting it only produces a warning.
    // These tests are about response headers and need no backend state, so
    // no mail emulator and no migrated database either.
    env: BUILD_ENV,
  },
});
