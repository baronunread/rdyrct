import { expect, test, type Page } from "@playwright/test";
import { pinHeroVariant } from "./pages";

// The landing hero A/B test. The variant is a coin flip in the page, with no
// consent needed and no request made to pick it, so every visitor is in the
// test and only the measuring waits for Accept.

const POSTHOG_GLOB = "**/*.i.posthog.com/**";
const CONSENT_KEY = "rdyrct:consent:v2";

async function openLandingAs(page: Page, variant: "control" | "test") {
  const attempts: string[] = [];
  await page.route(POSTHOG_GLOB, (route) => {
    attempts.push(route.request().url());
    return route.abort();
  });
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
    await expect(page.getByRole("link", { name: "See the analytics" })).toBeVisible();
  });

  test("the test arm shows the demo-first hero, before and without consent", async ({ page }) => {
    const attempts = await openLandingAs(page, "test");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Shorten a link. See who clicks it.",
    );
    await expect(page.getByRole("link", { name: "See the analytics" })).toHaveCount(0);
    await expect(page.getByLabel("Shorten a link, no account needed")).toBeVisible();

    // Picking the arm contacted nobody and wrote nothing down.
    await page.waitForTimeout(600);
    expect(attempts).toEqual([]);
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
    expect(stored).not.toMatch(/hero|variant/);
  });

  test("the demo-first hero's signup link stays in the app", async ({ page }) => {
    await openLandingAs(page, "test");
    // A full page load here would drop the click the buffer is holding.
    await page.evaluate(() => (document.documentElement.dataset.stayed = "yes"));
    await page.getByRole("link", { name: "Skip the demo, get started free" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    expect(await page.evaluate(() => document.documentElement.dataset.stayed)).toBe("yes");
  });
});

test.describe("cookie settings", () => {
  test("reopens the banner so an earlier Accept can be withdrawn", async ({ page }) => {
    await page.addInitScript((key) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, "accepted");
    }, CONSENT_KEY);
    await page.route(POSTHOG_GLOB, (route) => route.abort());
    await page.goto("/privacy");
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);

    await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
    await page.getByRole("button", { name: "Reject" }).click();

    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe("rejected");
  });
});
