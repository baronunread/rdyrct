import { expect, test, type Page } from "@playwright/test";
import { pinHeroVariant } from "./pages";

// The landing hero A/B test. Anonymous visitors see the control until they
// accept analytics; then one local coin flip picks an arm and stays put.

const POSTHOG_GLOB = "**/*.i.posthog.com/**";
const CONSENT_KEY = "rdyrct:consent:v2";
const HERO_VARIANT_KEY = "rdyrct:hero-variant:v1";

async function blockPosthog(page: Page, attempts?: string[]) {
  await page.route(POSTHOG_GLOB, (route) => {
    attempts?.push(route.request().url());
    return route.abort();
  });
}

async function seedConsent(page: Page, onlyIfUnset = false) {
  await page.addInitScript(
    ({ key, onlyIfUnset }) => {
      if (onlyIfUnset && localStorage.getItem(key) !== null) return;
      localStorage.setItem(key, "accepted");
      localStorage.setItem(`${key}:at`, String(Date.now()));
    },
    { key: CONSENT_KEY, onlyIfUnset },
  );
}

async function openCookieSettings(page: Page) {
  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
}

async function rejectConsent(page: Page) {
  await page.getByRole("button", { name: "Reject" }).click();
}

async function openLandingAs(page: Page, variant: "control" | "test") {
  const attempts: string[] = [];
  await blockPosthog(page, attempts);
  await seedConsent(page);
  await pinHeroVariant(page, variant);
  await page.goto("/");
  return attempts;
}

test.describe("landing hero A/B test", () => {
  test("the control arm shows the copy-first hero", async ({ page }) => {
    await openLandingAs(page, "control");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Short links and QR codes that show which channel earned the click.",
    );
    await expect(page.getByRole("link", { name: "See how it works" })).toBeVisible();
  });

  test("the test arm shows the demo-first hero after consent", async ({ page }) => {
    await openLandingAs(page, "test");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Shorten a link. See who clicks it.",
    );
    await expect(page.getByRole("link", { name: "See how it works" })).toHaveCount(0);
    await expect(page.getByLabel("Shorten a link, no account needed")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), HERO_VARIANT_KEY)).toBe("test");
  });

  test("the demo-first hero's signup link stays in the app", async ({ page }) => {
    await openLandingAs(page, "test");
    // A full page load here would drop the click the buffer is holding.
    await page.evaluate(() => (document.documentElement.dataset.stayed = "yes"));
    await page.getByRole("link", { name: "Skip the demo, get started free" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    expect(await page.evaluate(() => document.documentElement.dataset.stayed)).toBe("yes");
  });

  test("keeps control before consent, then keeps the accepted variant across reloads", async ({
    page,
  }) => {
    const attempts: string[] = [];
    await blockPosthog(page, attempts);
    await page.addInitScript(() => {
      Math.random = () => 0.9;
    });
    await page.goto("/");

    const controlHeading = "Short links and QR codes that show which channel earned the click.";
    const testHeading = "Shorten a link. See who clicks it.";
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(controlHeading);
    expect(await page.evaluate((key) => localStorage.getItem(key), HERO_VARIANT_KEY)).toBeNull();
    await expect.poll(() => attempts).toEqual([]);

    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(testHeading);
    expect(await page.evaluate((key) => localStorage.getItem(key), HERO_VARIANT_KEY)).toBe("test");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(testHeading);
    expect(await page.evaluate((key) => localStorage.getItem(key), HERO_VARIANT_KEY)).toBe("test");

    await openCookieSettings(page);
    await rejectConsent(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(controlHeading);
    expect(await page.evaluate((key) => localStorage.getItem(key), HERO_VARIANT_KEY)).toBeNull();
  });

  test("clears the assigned hero when consent is rejected in another tab", async ({ page }) => {
    await openLandingAs(page, "test");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Shorten a link. See who clicks it.",
    );

    const otherTab = await page.context().newPage();
    await otherTab.goto("/");
    await otherTab.evaluate((key) => localStorage.setItem(key, "rejected"), CONSENT_KEY);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Short links and QR codes that show which channel earned the click.",
    );
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), HERO_VARIANT_KEY))
      .toBeNull();
    await otherTab.close();
  });
});

test.describe("cookie settings", () => {
  test("withdrawing deletes PostHog's cookie and storage and sends nothing more", async ({
    page,
  }) => {
    const attempts: string[] = [];
    await blockPosthog(page, attempts);
    await seedConsent(page, true);
    await page.goto("/privacy");

    const posthogStorage = () =>
      page.evaluate(() => ({
        stored: Object.keys(localStorage).filter((key) => /^ph_.+_posthog$/.test(key)),
        cookies: document.cookie.split("; ").filter((c) => /^ph_.+_posthog=/.test(c)),
      }));
    // The client has loaded and written its identity.
    await expect.poll(async () => (await posthogStorage()).stored.length).toBeGreaterThan(0);

    await openCookieSettings(page);
    const before = attempts.length;
    await rejectConsent(page);

    await expect.poll(posthogStorage).toEqual({ stored: [], cookies: [] });
    await page.waitForTimeout(600);
    expect(attempts.slice(before)).toEqual([]);
  });

  test("reopens the banner so an earlier Accept can be withdrawn", async ({ page }) => {
    await seedConsent(page, true);
    await blockPosthog(page);
    await page.goto("/privacy");
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);

    await openCookieSettings(page);
    await rejectConsent(page);

    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe("rejected");
  });
});
