import { expect, test } from "@playwright/test";

// The funnel (#64) is only worth anything if the consent gate holds, so these
// assert the privacy behaviour first and the instrumentation second.
//
// Nothing here talks to PostHog. Every test blocks its hosts outright and
// watches what the app *tries* to send, which is the thing that matters: a
// request that leaves the browser has already leaked, whether or not the far
// end is reachable.

const POSTHOG_GLOB = "**/*.i.posthog.com/**";
const CONSENT_KEY = "rdyrct:consent:v2";

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
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  return attempts;
}

test("a visitor who has not answered the banner sends nothing to PostHog", async ({ page }) => {
  const attempts = await openLanding(page);

  // Scroll the whole page: this fires the landing view and the pricing-viewed
  // step, the two that happen before anyone could plausibly have consented.
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
  await page.getByRole("link", { name: /see the analytics/i }).click();
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
  await page.getByRole("link", { name: /see the analytics/i }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);

  expect(attempts).toEqual([]);
});

// The buffer holds events in memory. It must not survive a reload, or a
// visitor who reloads and then rejects would have their earlier steps sent.
test("the pre-consent buffer does not survive a reload", async ({ page }) => {
  const attempts = await openLanding(page);
  await page.getByRole("link", { name: /see the analytics/i }).click();
  await page.reload();
  await page.getByRole("button", { name: "Reject" }).click();
  await page.waitForTimeout(600);

  expect(attempts).toEqual([]);
  // Nothing about the queue should have been written down anywhere.
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(stored).not.toContain("funnel_");
});
