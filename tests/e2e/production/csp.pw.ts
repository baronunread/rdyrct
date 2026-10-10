import { expect, test } from "@playwright/test";
import { collectCspViolations, cspViolations, scriptIsBlocked } from "../csp";
import { visitLegalPages } from "../pages";

/**
 * These run against `vite preview`, i.e. the built worker and built assets,
 * because that is the only place the production Content-Security-Policy is in
 * force. Under `vite dev` the policy is deliberately looser (Vite injects an
 * inline React Refresh preamble that `script-src 'self'` would refuse), so the
 * dev suite cannot speak to what ships.
 */

test.beforeEach(async ({ page }) => {
  await collectCspViolations(page);
});

test("the built worker serves the production CSP", async ({ page }) => {
  // Every other test here asks the browser what the policy refused, which a
  // page carrying no policy at all answers with silence. Pin the header first,
  // so a preview server that stopped running applySecurityHeaders fails loudly
  // instead of turning the rest of this file green.
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"];

  expect(csp).toBeTruthy();
  // style-src carries 'unsafe-inline' by design (React inline `style`), so the
  // check that matters is script-src alone, read as its own directive. The
  // sha256 is the theme bootstrap inlined in index.html; script-src still has
  // no 'unsafe-inline', which is the whole point of naming it by hash.
  const scriptSrc = csp?.split(";").find((part) => part.trim().startsWith("script-src"));
  expect(scriptSrc?.trim()).toBe(
    "script-src 'self' 'sha256-FWT0zAeXgLYQzK+k6AJ0ya6gTIN/5TC8uQ3OB6H8w6A=' https://*.posthog.com https://stats.brnr.dev https://challenges.cloudflare.com",
  );
  const connectSrc = csp?.split(";").find((part) => part.trim().startsWith("connect-src"));
  expect(connectSrc?.trim()).toBe(
    "connect-src 'self' https://*.posthog.com https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://*.ingest.us.sentry.io https://stats.brnr.dev",
  );
});

// The hash above only means anything if the browser actually ran the script
// it names. A refused one is silent: the page just paints in the wrong theme,
// and every other test here still passes. So read the theme the document
// ended up in, on a browser whose OS says dark, from the real built worker
// under the real policy.
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
 * Turnstile (#304) is the part of this app most likely to be strangled by our
 * own policy, and it fails quietly: a blocked script or iframe leaves signup
 * looking fine with no token to send. So this asserts the mechanism, not just
 * the absence of complaints: the script loads from challenges.cloudflare.com
 * and the widget, rendered with Cloudflare's always-pass test key, hands back
 * a token, with no CSP violation along the way.
 */
test("Turnstile solves a challenge under the production CSP", async ({ page }) => {
  await page.goto("/signup");

  // /signup is prerendered, so an input typed before hydration finishes never
  // reaches the handler that starts the widget. Type again until it is there.
  let attempt = 0;
  await expect(async () => {
    attempt += 1;
    await page.getByRole("textbox").first().fill(`csp-probe-${attempt}@example.com`);
    await page.waitForFunction(() => !!window.turnstile, null, { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });

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

  // The landing mockup mounts real QRPreview components, one of them with an
  // embedded logo, so qr-code-styling's rendering path is exercised here
  // without needing an account. It draws through image and canvas APIs, which
  // is exactly what img-src governs.
  await expect(page.locator("svg:visible").first()).toBeVisible();
  await page.waitForTimeout(1500);

  const violations = await cspViolations(page);
  expect(violations.filter((v) => v.directive.startsWith("img-src"))).toEqual([]);
  expect(violations).toEqual([]);
});

test("legal pages render under the production CSP without violations", async ({ page }) => {
  // Violations are recorded on `window`, and the collector re-runs on every
  // navigation, so /privacy's record is already gone by the time /terms has
  // loaded. Each page has to be asserted before we leave it.
  await visitLegalPages(page, async (path) => {
    expect(await cspViolations(page), path).toEqual([]);
  });
});

test("the production CSP permits the scripts PostHog fetches at runtime", async ({ page }) => {
  await page.goto("/");

  // posthog-js does not ship its optional features in the bundle. It builds
  // `<assets host>/static/<name>.js` and injects it with
  // document.createElement("script") the first time one is needed, and
  // src/app/lib/posthog.ts turns on `capture_exceptions`, which is one of
  // them. connect-src and img-src already allowlist PostHog; script-src has
  // to agree, or exception capture dies silently in production while every
  // test stays green.
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
