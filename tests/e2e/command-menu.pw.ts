import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";
const PLACEHOLDER = "Search pages and actions…";

test("the command menu navigates and toggles the theme", async ({ page }) => {
  await signUpAndVerify(page, `cmdk-${Date.now()}@gmail.com`, password);
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();

  // ⌘K / Ctrl+K opens it, focused; typing filters; Enter runs the top match.
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByPlaceholder(PLACEHOLDER);
  await expect(input).toBeFocused();
  await input.fill("links");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/links$/);
  await expect(input).toBeHidden();

  // Reopen, run the theme item, the root flips.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(PLACEHOLDER).fill("theme");
  const before = await page.locator("html").getAttribute("data-theme");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).not.toBe(before);

  // Esc closes it.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(page.getByPlaceholder(PLACEHOLDER)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder(PLACEHOLDER)).toBeHidden();
});
