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
  // check that matters is script-src alone, read as its own directive.
  const scriptSrc = csp?.split(";").find((part) => part.trim().startsWith("script-src"));
  expect(scriptSrc?.trim()).toBe("script-src 'self' 'wasm-unsafe-eval' https://*.posthog.com");
});

/**
 * Cap's proof-of-work (#98) is the part of this app most likely to be
 * strangled by our own policy, and it fails quietly: the widget catches its
 * own errors, so a blocked Worker or a refused WebAssembly.compile() would
 * leave signup apparently fine and completely unprotected.
 *
 * So this asserts the mechanism, not just the absence of complaints. The
 * solver runs in a Worker built from a blob: URL (worker-src) and compiles a
 * same-origin WASM module (script-src 'wasm-unsafe-eval'). Both were blocked
 * by the policy as it stood before this feature; the measured cost of losing
 * the WASM path is roughly 5x on solve time.
 */
test("Cap solves a challenge under the production CSP", async ({ page }) => {
  await page.goto("/signup");

  // The widget only loads once the visitor touches the form, which is the
  // whole point: no cost to anyone who does not sign up.
  await page.getByRole("textbox").first().fill("csp-probe@example.com");
  await page.waitForFunction(() => !!customElements.get("cap-widget"), null, { timeout: 15_000 });

  const solved = await page.evaluate(async () => {
    const el = document.createElement("cap-widget") as HTMLElement & {
      solve: () => Promise<{ token?: string }>;
    };
    el.setAttribute("data-cap-api-endpoint", "/api/cap/signup/");
    el.style.cssText = "position:absolute;width:1px;height:1px;opacity:0";
    document.body.appendChild(el);
    try {
      return (await el.solve())?.token ?? "";
    } finally {
      el.remove();
    }
  });

  expect(solved).not.toBe("");
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
  await expect(page.locator("svg").first()).toBeVisible();
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
