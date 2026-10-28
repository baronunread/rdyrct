import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

test("the sidebar folds to an icon rail, stays folded, and unfolds", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpAndVerify(page, `sidebar-${Date.now()}@gmail.com`, password);

  const sidebar = page.locator("aside").first();
  const width = async () => (await sidebar.boundingBox())?.width ?? 0;
  await expect.poll(width).toBe(240);

  await page.getByRole("button", { name: "Collapse sidebar ([)" }).click();
  await expect.poll(width).toBe(52);
  // The nav still works from the rail.
  await sidebar.getByRole("link", { name: "Links" }).click();
  await expect(page).toHaveURL(/\/links$/);

  // Folded is remembered across a reload, skeleton included.
  await page.reload();
  await expect.poll(width).toBe(52);

  // `[` unfolds it, but not while typing in a field.
  await page.getByPlaceholder("Search links…").fill("[");
  await expect.poll(width).toBe(52);
  await page.getByPlaceholder("Search links…").blur();
  await page.keyboard.press("[");
  await expect.poll(width).toBe(240);
});
