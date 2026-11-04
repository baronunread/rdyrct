import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

/** The Members page's chunk: its source module on the dev server, its hashed
 * file in a build. */
const membersChunk = (url: URL) =>
  url.pathname.includes("routes/members") || /\/assets\/members-[\w-]+\.js$/.test(url.pathname);

/** What a tab older than the last deploy meets: the chunk's old name is gone. */
async function deleteMembersChunk(page: Page) {
  await page.route(membersChunk, (route) => route.fulfill({ status: 404, body: "" }));
}

// A click into a page whose code is gone used to commit the navigation, find
// out while rendering, and leave a blank screen. lib/chunk-guard.ts loads the
// code first: the click goes nowhere, the page stays, and the banner's reload
// opens the page that was clicked.
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

  // The new deploy is in place: the reload opens the page that was clicked.
  await page.unroute(membersChunk);
  await banner.getByRole("button", { name: "Reload" }).click();
  await expect(page).toHaveURL(/\/members/);
  await expect(sheet.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
  await expect(banner).toBeHidden();
});
