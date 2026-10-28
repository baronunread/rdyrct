import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

test("the sidebar folds to an icon rail, stays folded, and unfolds", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndVerify(page, `sidebar-${Date.now()}@gmail.com`, password);

  const sidebar = page.locator("aside").first();
  const width = async () => (await sidebar.boundingBox())?.width ?? 0;
  await expect.poll(width).toBe(240);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(width).toBe(52);
  // The nav still works from the rail.
  await sidebar.getByRole("link", { name: "Links" }).click();
  await expect(page).toHaveURL(/\/links$/);

  // Folded is remembered across a reload, skeleton included.
  await page.reload();
  await expect.poll(width).toBe(52);

  // `[` unfolds it, but not while typing in a field.
  await page.getByPlaceholder("Search links").fill("[");
  await expect.poll(width).toBe(52);
  await page.getByPlaceholder("Search links").blur();
  await page.keyboard.press("[");
  await expect.poll(width).toBe(240);
});

test("on a phone the top bar searches and the drawer closes on the way out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = `sidebar-phone-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  // Search has its own button: a phone has no ⌘K.
  await page.getByRole("button", { name: "Search and commands" }).click();
  await expect(page.getByPlaceholder("Search links, pages and actions")).toBeVisible();
  await page.keyboard.press("Escape");

  // The drawer: the account row names the email, and a row takes you away
  // and closes it behind you.
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const account = page.getByRole("button", { name: "Account menu" });
  await expect(account).toContainText(email);
  await page.getByRole("link", { name: "Links", exact: true }).click();
  await expect(page).toHaveURL(/\/links$/);
  await expect(account).toBeHidden();
});

test("the account menu is headed by the name and email", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const email = `sidebar-account-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menu").getByText(email)).toBeVisible();
  await page.getByRole("menuitem", { name: "Search and commands" }).click();
  await expect(page.getByPlaceholder("Search links, pages and actions")).toBeVisible();
});
