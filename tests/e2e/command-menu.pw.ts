import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";

const password = "test-password-123";
const PLACEHOLDER = "Search pages, links and actions…";

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

test("the command menu searches the org's links", async ({ page }) => {
  await signUpAndVerify(page, `cmdk-links-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "https://example.com/palette-target");
  await page.getByRole("button", { name: /Close/i }).click();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(PLACEHOLDER).fill("palette-target");

  // The matching link shows under a Links group; Enter opens its detail page.
  const result = page
    .getByRole("option")
    .filter({ hasText: /rdyrct/ })
    .first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/links\/[^/]+$/);
});

test("the command menu creates a link from a pasted URL", async ({ page }) => {
  await signUpAndVerify(page, `cmdk-create-${Date.now()}@gmail.com`, password);
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(PLACEHOLDER).fill("https://example.com/from-cmdk");

  // A URL-shaped query offers a create item; running it makes the link and
  // lands on its detail page.
  const create = page.getByRole("option", { name: /Create link for/ });
  await expect(create).toBeVisible();
  await create.click();
  await expect(page).toHaveURL(/\/links\/[^/]+$/);
  await expect(page.getByText("https://example.com/from-cmdk")).toBeVisible();
});
