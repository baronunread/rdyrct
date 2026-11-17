import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { signOut } from "./pages";

const password = "test-password-123";

test("the sidebar survives a reload before /user answers", async ({ page }) => {
  const email = `playwright-shell-${Date.now()}@gmail.com`;
  const shellName = email.split("@")[0];
  const footer = page.getByRole("button", { name: "Account menu" });
  await signUpAndVerify(page, email, password);

  await page.goto("/links");
  await expect(footer).toContainText(shellName);

  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const isUserRequest = (url: URL) => url.pathname === "/api/user";
  await page.route(isUserRequest, async (route) => {
    await held;
    await route.continue();
  });

  await page.reload();
  await expect(footer).toContainText(shellName);
  await expect(page.getByRole("link", { name: "Links" })).toBeVisible();
  // A form offered from the cache would carry settings one page load stale.
  // .first(): a new org shows the button twice once the list lands (header and empty
  // state), a race with that query.
  const newLink = page.getByRole("button", { name: "New link" }).first();
  await expect(newLink).toBeHidden();

  release();
  await expect(footer).toContainText(shellName);
  await expect(newLink).toBeVisible();
});

test("signing out clears the cached shell", async ({ page }) => {
  const email = `playwright-signout-${Date.now()}@gmail.com`;
  const shellName = email.split("@")[0];
  await signUpAndVerify(page, email, password);

  await signOut(page);
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(shellName)).toBeHidden();
});
