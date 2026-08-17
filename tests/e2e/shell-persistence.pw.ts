import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

/**
 * A reload keeps the app shell on screen.
 *
 * The sidebar, org switcher and user footer are the same on every page for
 * the same person, so they are cached (`user-cache.ts`) and painted before
 * /user answers. The test holds that answer open: whatever is on screen while
 * the request is in flight is exactly what the cache paid for.
 */
test("the sidebar survives a reload before /user answers", async ({ page }) => {
  const email = `playwright-shell-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  await page.goto("/links");
  await expect(page.getByText(email)).toBeVisible();

  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const isUserRequest = (url: URL) => url.pathname === "/api/user";
  await page.route(isUserRequest, async (route) => {
    await held;
    await route.continue();
  });

  await page.reload();
  // No answer to /user has been given, and the shell is already there.
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("link", { name: "Links" })).toBeVisible();
  // The chrome is cached; the page under it is not. A form offered from the
  // cache would carry settings one page load out of date, which is how a
  // link ends up on the domain the org stopped defaulting to.
  await expect(page.getByRole("button", { name: "New link" })).toBeHidden();

  // Let the check land: the cache is a first frame, not a replacement for it.
  release();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("button", { name: "New link" })).toBeVisible();
});

/** Signing out drops the cache: the next visitor to this browser is a
 * stranger, and must not see the last person's name flash on screen. */
test("signing out clears the cached shell", async ({ page }) => {
  const email = `playwright-signout-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  await page.getByLabel("Sign out").click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(email)).toBeHidden();
});
