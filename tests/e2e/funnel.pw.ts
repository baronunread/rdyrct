import { expect, test } from "@playwright/test";
import { gunzipSync } from "node:zlib";

// Tests block PostHog's hosts and watch what the app tries to send: a request
// that leaves the browser has already leaked, reachable or not.

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

test("the hero signup CTA navigates in-page", async ({ page }) => {
  await trapPostHog(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  const hero = page.locator("[data-hero]");
  await expect(hero).toBeVisible();
  const documentId = await page.evaluate(() => performance.timeOrigin);
  await hero.getByRole("link", { name: "Get started free", exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentId);
});

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

/** A CTA click that fires the funnel step and stays on the page. The hero's
 *  one CTA is a link to /signup; leaving would drop the in-memory buffer these
 *  tests are about, so the navigation is cancelled and the handler still runs. */
async function clickHeroCta(page: import("@playwright/test").Page) {
  await page
    .getByRole("link", { name: "Get started free" })
    .first()
    .evaluate((link) => {
      link.addEventListener("click", (event) => event.preventDefault(), { once: true });
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
}

async function openLanding(page: import("@playwright/test").Page) {
  const attempts = await trapPostHog(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  return attempts;
}

test("a visitor who has not answered the banner sends nothing to PostHog", async ({ page }) => {
  const attempts = await openLanding(page);

  // Scroll the whole page to fire the pricing-viewed step. The landing-view
  // event waits until analytics consent.
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
  await clickHeroCta(page);
  await page.waitForTimeout(300);
  expect(attempts).toEqual([]);

  await page.getByRole("button", { name: "Accept" }).click();

  await expect.poll(() => attempts.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe("accepted");
});

// That nothing is queued is asserted in tests/consent-buffer.test.ts: here "no
// request" looks the same either way, since the config request is intercepted.
test("browsing on after a rejection stays silent", async ({ page }) => {
  const attempts = await openLanding(page);

  await page.getByRole("button", { name: "Reject" }).click();
  await clickHeroCta(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);

  expect(attempts).toEqual([]);
});

// The buffer holds events in memory. It must not survive a reload, or a
// visitor who reloads and then rejects would have their earlier steps sent.
test("the pre-consent buffer does not survive a reload", async ({ page }) => {
  const attempts = await openLanding(page);
  await clickHeroCta(page);
  await page.reload();
  await page.getByRole("button", { name: "Reject" }).click();
  await page.waitForTimeout(600);

  expect(attempts).toEqual([]);
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(stored).not.toContain("funnel_");
});
