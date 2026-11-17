import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

const membersChunk = (url: URL) =>
  url.pathname.includes("routes/members") || /\/assets\/members-[\w-]+\.js$/.test(url.pathname);

async function deleteMembersChunk(page: Page) {
  await page.route(membersChunk, (route) => route.fulfill({ status: 404, body: "" }));
}

// lib/chunk-guard.ts loads a page's code before navigating: the click goes nowhere,
// and the banner's reload opens the clicked page.
test("a click into a page whose chunk is gone keeps the page and offers a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndVerify(page, `stale-chunk-${Date.now()}@gmail.com`, password);
  await expect(page).toHaveURL(/\/dashboard/);
  const sheet = page.locator("[data-app-sheet]");
  await expect(sheet.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

  await deleteMembersChunk(page);
  await page.locator("aside").first().getByRole("link", { name: "Members", exact: true }).click();

  const banner = page.getByRole("alert").filter({ hasText: "A new version is available." });
  await expect(banner).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(sheet.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

  await page.unroute(membersChunk);
  await banner.getByRole("button", { name: "Reload" }).click();
  await expect(page).toHaveURL(/\/members/);
  // A full page load on a cold dev server can take a while.
  await expect(sheet.getByRole("heading", { name: "Members", level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await expect(banner).toBeHidden();
});

// In a build, hover preloads the chunk and raises the notice before the click (dev has
// no such helper). The notice must not cover the link, or the next click never lands.
test("the notice leaves the header link clickable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route(
    (url) =>
      url.pathname.includes("routes/pricing") || /\/assets\/pricing-[\w-]+\.js$/.test(url.pathname),
    (route) => route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/", { waitUntil: "networkidle" });
  const link = page.locator("header").getByRole("link", { name: "Pricing" }).first();
  await link.click();
  const banner = page.getByRole("alert").filter({ hasText: "A new version is available." });
  await expect(banner).toBeVisible();
  // Playwright refuses a click another element would receive.
  await link.click({ timeout: 5000 });
  await expect(page).toHaveURL(/\/$/);
  await expect(banner).toBeVisible();
});

// Back and Forward change the URL before the guard hears of them, so a missing chunk
// fails while rendering; RouteError then reloads, and once that cannot help shows the notice.
test("Back onto a page whose chunk is gone never shows the router's error", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndVerify(page, `stale-back-${Date.now()}@gmail.com`, password);
  await expect(page).toHaveURL(/\/dashboard/);

  await deleteMembersChunk(page);
  await page.evaluate(() => {
    history.pushState(history.state, "", "/members");
    history.pushState(history.state, "", "/dashboard");
  });
  await page.goBack();

  await expect(page).toHaveURL(/\/members/);
  await expect(
    page.getByRole("heading", { name: "A new version is available.", level: 1 }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Something went wrong!")).toHaveCount(0);
  await expect(page.getByText(/Failed to fetch dynamically imported module/)).toHaveCount(0);
});
