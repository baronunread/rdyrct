import { expect, test, type Page } from "@playwright/test";
import { pinHeroVariant } from "./pages";

// The landing hero copy test: two headings over the same hero, decided on
// signups. Anonymous visitors read the control until they accept analytics;
// then one local coin flip picks an arm and it stays put.

const POSTHOG_GLOB = "**/*.i.posthog.com/**";
const CONSENT_KEY = "rdyrct:consent:v2";
const ARM_KEY = "rdyrct:hero-variant:v2";
const OWN = "Turn long links into your own.";
const ANSWERS = "The link shortener that answers to you.";

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

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** A consenting browser whose coin lands on the challenger. */
async function openInChallengerArm(page: Page) {
  await blockPosthog(page);
  await seedConsent(page);
  await pinHeroVariant(page, "answers");
  await page.goto("/");
  await expect(heading(page)).toHaveText(ANSWERS);
}

const storedArm = (page: Page) => page.evaluate((key) => localStorage.getItem(key), ARM_KEY);

test.describe("landing hero copy test", () => {
  test("each arm shows its own heading, and only that one", async ({ page }) => {
    await openInChallengerArm(page);
    expect(await storedArm(page)).toBe("answers");
    // Once hydrated, the other arm is gone from the page, not just hidden.
    await expect(page.getByText(OWN)).toHaveCount(0);
  });

  // That the arm is right before hydration, so nothing flips, needs the
  // prerendered page: production/prerendered-pages.pw.ts checks it.

  test("keeps control before consent, then keeps the accepted arm across reloads", async ({
    page,
  }) => {
    const attempts: string[] = [];
    await blockPosthog(page, attempts);
    await pinHeroVariant(page, "answers");
    await page.goto("/");

    await expect(heading(page)).toHaveText(OWN);
    expect(await storedArm(page)).toBeNull();
    await expect.poll(() => attempts).toEqual([]);

    await page.getByRole("button", { name: "Accept" }).click();
    await expect(heading(page)).toHaveText(ANSWERS);
    expect(await storedArm(page)).toBe("answers");

    await page.reload();
    await expect(heading(page)).toHaveText(ANSWERS);

    await openCookieSettings(page);
    await rejectConsent(page);
    await expect(heading(page)).toHaveText(OWN);
    expect(await storedArm(page)).toBeNull();
  });

  test("forgets the arm when consent is rejected in another tab", async ({ page }) => {
    await openInChallengerArm(page);

    const otherTab = await page.context().newPage();
    await otherTab.goto("/privacy");
    await otherTab.evaluate((key) => localStorage.setItem(key, "rejected"), CONSENT_KEY);

    await expect(heading(page)).toHaveText(OWN);
    await expect.poll(() => storedArm(page)).toBeNull();
    await otherTab.close();
  });

  test("drops the arm the earlier layout test stored", async ({ page }) => {
    await blockPosthog(page);
    await page.addInitScript(() => localStorage.setItem("rdyrct:hero-variant:v1", "test"));
    await page.goto("/");
    await expect(heading(page)).toHaveText(OWN);
    expect(await page.evaluate(() => localStorage.getItem("rdyrct:hero-variant:v1"))).toBeNull();
  });
});

// These lived in the earlier experiment's spec and went with it; they are
// about consent, not the hero.
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
