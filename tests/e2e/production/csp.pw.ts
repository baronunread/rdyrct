import { expect, test } from "@playwright/test";
import { collectCspViolations, cspViolations, scriptIsBlocked } from "../csp";
import { visitLegalPages } from "../pages";

/**
 * Runs against `vite preview`: only the built worker enforces the production
 * CSP. Under `vite dev` it is looser (React Refresh's inline preamble).
 */

test.beforeEach(async ({ page }) => {
  await collectCspViolations(page);
});

test("the built worker serves the production CSP", async ({ page }) => {
  // A page with no policy answers every other test here with silence: pin the
  // header so a preview that stopped applying it fails loudly.
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"];

  expect(csp).toBeTruthy();
  // style-src has 'unsafe-inline' (React inline style), so check script-src
  // alone: it names the theme bootstrap by sha256, with no 'unsafe-inline'.
  const scriptSrc = csp?.split(";").find((part) => part.trim().startsWith("script-src"));
  expect(scriptSrc?.trim()).toBe(
    "script-src 'self' 'sha256-WT7DRSIUPW1UJ8Sl+CccEgo69mkW5WedEO/xrvrD5hQ=' https://*.posthog.com https://stats.brnr.dev https://challenges.cloudflare.com",
  );
  const connectSrc = csp?.split(";").find((part) => part.trim().startsWith("connect-src"));
  expect(connectSrc?.trim()).toBe(
    "connect-src 'self' https://*.posthog.com https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://*.ingest.us.sentry.io https://stats.brnr.dev",
  );
});

// The hash only matters if the browser ran the script. A refused one is
// silent (wrong theme, other tests pass), so read the theme the document ended
// up in, on a dark-OS browser, under the real policy.
test("the inlined theme bootstrap survives the production CSP", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await collectCspViolations(page);

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await cspViolations(page)).toEqual([]);

  await context.close();
});

/**
 * Turnstile (#304) fails quietly under our CSP, so assert the mechanism: the
 * script loads from challenges.cloudflare.com and the widget yields a token.
 * The script is added here: this preview has no database behind /api/config.
 */
test("Turnstile solves a challenge under the production CSP", async ({ page }) => {
  await page.goto("/signup");
  await page.addScriptTag({
    url: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  });
  await page.waitForFunction(() => !!window.turnstile, null, { timeout: 15_000 });

  const token = await page.evaluate(
    (siteKey) =>
      new Promise<string>((resolve) => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        window.turnstile?.render(host, {
          sitekey: siteKey,
          action: "signup",
          appearance: "interaction-only",
          callback: resolve,
          "error-callback": () => resolve(""),
          "timeout-callback": () => resolve(""),
        });
        setTimeout(() => resolve(""), 15_000);
      }),
    "1x00000000000000000000AA",
  );

  expect(token).not.toBe("");
  expect(await cspViolations(page)).toEqual([]);
});

test("the landing page renders under the production CSP without violations", async ({ page }) => {
  await page.goto("/");

  // Rendering, not just responding: a blocked module leaves the pre-render
  // fallback in place, which still returns 200.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();

  expect(await cspViolations(page)).toEqual([]);
});

test("QR previews render under the production CSP without violations", async ({ page }) => {
  await page.goto("/");

  // The landing mockup mounts real QRPreview components, one with a logo, so
  // qr-code-styling's image and canvas path (img-src) runs. The QR section is
  // scrolled to because its cards draw only on screen.
  await page
    .getByRole("heading", { name: "Print once. Change it later." })
    .scrollIntoViewIfNeeded();
  await expect(page.locator("svg image").first()).toBeAttached();

  const violations = await cspViolations(page);
  expect(violations.filter((v) => v.directive.startsWith("img-src"))).toEqual([]);
  expect(violations).toEqual([]);
});

test("legal pages render under the production CSP without violations", async ({ page }) => {
  // Violations live on `window` and the collector re-runs per navigation, so
  // assert each page before leaving it.
  await visitLegalPages(page, async (path) => {
    expect(await cspViolations(page), path).toEqual([]);
  });
});

test("the production CSP permits the scripts PostHog fetches at runtime", async ({ page }) => {
  await page.goto("/");

  // posthog-js injects optional features (capture_exceptions) as
  // <assets host>/static/<name>.js at runtime: script-src must agree with
  // connect-src, or exception capture dies silently in production.
  const blocked = await scriptIsBlocked(
    page,
    "https://us-assets.i.posthog.com/static/exception-autocapture.js",
  );

  expect(blocked).toBe(false);
});

test("the production CSP permits the stats script", async ({ page }) => {
  await page.goto("/");

  const script = page.locator(
    'head script[defer][data-domain="rdyrct.com"][src="https://stats.brnr.dev/js/4c6e73d608dd3a5e7b28ec7a6fd6a53a.js"]',
  );
  await expect(script).toHaveCount(1);
  expect(
    await scriptIsBlocked(
      page,
      "https://stats.brnr.dev/js/4c6e73d608dd3a5e7b28ec7a6fd6a53a.js?csp-probe=1",
    ),
  ).toBe(false);
});
