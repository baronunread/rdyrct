import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

// Signed in, a page the app does not have keeps the shell around it: the
// sidebar is the way back, and the page says the links are safe. Signed out,
// the public 404 is unchanged (not-found.pw.ts).

test("a mistyped app address stays inside the app", async ({ page }) => {
  await signUpAndVerify(page, `app-404-${Date.now()}@gmail.com`, password);

  await page.goto("/dashbord");
  await expect(
    page.getByRole("heading", { level: 1, name: "This page does not exist" }),
  ).toBeVisible();
  await expect(page.getByText("Your links and data are fine.", { exact: false })).toBeVisible();
  // The shell is still there.
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

  // Search opens ⌘K from the page.
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Search/ })
    .click();
  await expect(page.getByPlaceholder("Search links, pages and actions")).toBeFocused();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Go to the dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("an admin page is an in-app 404 for everybody else", async ({ page }) => {
  await signUpAndVerify(page, `app-404-admin-${Date.now()}@gmail.com`, password);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { level: 1, name: "This page does not exist" }),
  ).toBeVisible();
  // One shell, not one drawn inside another.
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(1);
});
