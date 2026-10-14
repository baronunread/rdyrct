import { expect, test } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { pinHeroVariant } from "./pages";

// The funnel (#64) is only worth anything if the consent gate holds, so these
// assert the privacy behaviour first and the instrumentation second.
//
// Nothing here talks to PostHog. Every test blocks its hosts outright and
// watches what the app *tries* to send, which is the thing that matters: a
// request that leaves the browser has already leaked, whether or not the far
// end is reachable.

const POSTHOG_GLOB = "**/*.i.posthog.com/**";
const CONSENT_KEY = "rdyrct:consent:v2";

test("local browser analytics uses the test project after consent", async ({ page }) => {
  const tokens: string[] = [];
  await trapPostHog(page);
  page.on("request", (request) => {
    if (!request.url().includes(".i.posthog.com/flags")) return;
    const payload = request.postDataBuffer();
    // The SDK compresses its flags request, even before capture starts.
    if (payload) tokens.push((payload[0] === 0x1f ? gunzipSync(payload) : payload).toString());
    tokens.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => tokens.join(" ")).toContain("phc_e2e");
});

for (const variant of ["control", "test"] as const) {
  test(`${variant} signup CTA navigates in-page and keeps attribution after reload`, async ({
    page,
  }) => {
    await trapPostHog(page);
    await pinHeroVariant(page, variant);
    await page.goto("/");
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    const hero = page.locator(`[data-hero-arm="${variant}"]`);
    await expect(hero).toBeVisible();
    const documentId = await page.evaluate(() => performance.timeOrigin);
    await hero
      .getByRole("link", {
        name: variant === "test" ? "Skip the demo, get started free" : "Get started free",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentId);

    // A fresh signup document is also what an OAuth round trip creates.
    // Exercise the real attribution helper without sending analytics traffic.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    const attribution = await page.evaluate(async () => {
      const modulePath = "/src/app/lib/posthog.ts";
      const { withHeroVariant } = await import(modulePath);
      return ["funnel_signup_viewed", "user_signed_up", "funnel_link_created"].map((event) =>
        withHeroVariant(event),
      );
    });
    expect(attribution).toEqual(Array.from({ length: 3 }, () => ({ hero_variant: variant })));
  });
}

/** Records every request the page attempts toward PostHog, and blocks them. */
async function trapPostHog(page: import("@playwright/test").Page) {
  const attempts: string[] = [];
  await page.route(POSTHOG_GLOB, (route) => {
    attempts.push(route.request().url());
    return route.abort();
  });
  // posthog-js also pulls its bundle from the assets host.
  await page.route("**/us-assets.i.posthog.com/**", (route) => {
    attempts.push(route.request().url());
    return route.abort();
  });
  return attempts;
}

/** Trap PostHog, open the landing page, wait for it to render. Every test
 *  here starts this way. */
async function openLanding(page: import("@playwright/test").Page) {
  const attempts = await trapPostHog(page);
  // These click "See how it works", which only the control hero has.
  await pinHeroVariant(page, "control");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  return attempts;
}

test("a visitor who has not answered the banner sends nothing to PostHog", async ({ page }) => {
  const attempts = await openLanding(page);

  // Scroll the whole page to fire the pricing-viewed step. The landing-view
  // event waits until analytics consent so its assigned hero arm is accurate.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(600);

  expect(attempts).toEqual([]);
});

test("rejecting keeps PostHog off and discards what was buffered", async ({ page }) => {
  const attempts = await openLanding(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("button", { name: "Reject" }).click();
  await page.waitForTimeout(600);

  expect(attempts).toEqual([]);

  // And it stays off across a reload, rather than re-prompting and re-arming.
  await page.reload();
  await page.waitForTimeout(600);
  expect(attempts).toEqual([]);
  expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe("rejected");
});

test("accepting flushes the steps that happened before the banner was answered", async ({
  page,
}) => {
  const attempts = await openLanding(page);

  // A CTA click before answering the banner. It must not be sent yet, and it
  // must not be lost either: this is the buffer's whole reason to exist.
  await page.getByRole("link", { name: /see how it works/i }).click();
  await page.waitForTimeout(300);
  expect(attempts).toEqual([]);

  await page.getByRole("button", { name: "Accept" }).click();

  // Now it should try to reach PostHog. The requests are blocked, so this
  // asserts intent, not delivery.
  await expect.poll(() => attempts.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe("accepted");
});

// Rejected is not the same as unanswered: browsing on after a refusal must
// stay silent, not merely unsent-for-now.
//
// That the rejected period is never even *queued* is asserted directly in
// tests/consent-buffer.test.ts. It cannot be asserted here, because a capture
// batch never leaves the browser while the test intercepts PostHog's config
// request, so "no request" would look identical either way.
test("browsing on after a rejection stays silent", async ({ page }) => {
  const attempts = await openLanding(page);

  await page.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("link", { name: /see how it works/i }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);

  expect(attempts).toEqual([]);
});

// The buffer holds events in memory. It must not survive a reload, or a
// visitor who reloads and then rejects would have their earlier steps sent.
test("the pre-consent buffer does not survive a reload", async ({ page }) => {
  const attempts = await openLanding(page);
  await page.getByRole("link", { name: /see how it works/i }).click();
  await page.reload();
  await page.getByRole("button", { name: "Reject" }).click();
  await page.waitForTimeout(600);

  expect(attempts).toEqual([]);
  // Nothing about the queue should have been written down anywhere.
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(stored).not.toContain("funnel_");
});
