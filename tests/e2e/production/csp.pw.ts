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
  await expect(page.locator("svg").first()).toBeVisible();
  await page.waitForTimeout(1500);

  const violations = await cspViolations(page);
  expect(violations.filter((v) => v.directive.startsWith("img-src"))).toEqual([]);
  expect(violations).toEqual([]);
});

test("legal pages render under the production CSP without violations", async ({ page }) => {
  await visitLegalPages(page);

  expect(await cspViolations(page)).toEqual([]);
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
