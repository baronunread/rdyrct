import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";

const password = "test-password-123";
const ALL = "Search pages and actions…";
const LINKS = "Search your links";

test("the command menu navigates and toggles the theme", async ({ page }) => {
  await signUpAndVerify(page, `cmdk-${Date.now()}@gmail.com`, password);
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();

  // ⌘K / Ctrl+K opens it, focused; typing filters; Enter runs the top match.
  await page.keyboard.press("ControlOrMeta+KeyK");
  const input = page.getByPlaceholder(ALL);
  await expect(input).toBeFocused();
  await input.fill("links");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/links$/);
  await expect(input).toBeHidden();

  // Reopen, run the theme item, the root flips.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(ALL).fill("theme");
  const before = await page.locator("html").getAttribute("data-theme");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).not.toBe(before);

  // Esc closes it.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(page.getByPlaceholder(ALL)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder(ALL)).toBeHidden();
});

test("the link scope searches the org's links, and Backspace pops the pill", async ({ page }) => {
  await signUpAndVerify(page, `cmdk-links-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "https://example.com/palette-target");
  await page.getByRole("button", { name: /Close/i }).click();

  await page.keyboard.press("ControlOrMeta+KeyK");
  // `link:` becomes a pill and the field switches to searching links.
  await page.getByPlaceholder(ALL).fill("link:");
  await expect(page.getByPlaceholder(LINKS)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear link filter" })).toBeVisible();

  await page.getByPlaceholder(LINKS).fill("palette-target");
  // In link scope every option is a short URL; the host varies by env.
  const result = page
    .getByRole("option")
    .filter({ hasText: /https?:\/\// })
    .first();
  await expect(result).toBeVisible();

  // Backspace on the empty field clears the pill, back to the default scope.
  await page.getByPlaceholder(LINKS).fill("");
  await page.keyboard.press("Backspace");
  await expect(page.getByPlaceholder(ALL)).toBeVisible();
});

test("the command menu creates a link, alias flow included", async ({ page }) => {
  await signUpAndVerify(page, `cmdk-create-${Date.now()}@gmail.com`, password);
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(ALL).fill("https://example.com/from-cmdk");

  // A URL-shaped query offers a create item; running it makes the link and
  // opens the same QR-and-short-URL dialog the dashboard quick-create uses.
  const create = page.getByRole("option", { name: /Create link for/ });
  await expect(create).toBeVisible();
  await create.click();

  const dialog = page.getByRole("dialog", { name: "Link created" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: /QR/i })).toBeVisible();
  await dialog.getByRole("button", { name: /Close/i }).click();
  await expect(dialog).toBeHidden();

  // Creating the same destination again runs the dashboard's alias flow.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(ALL).fill("https://example.com/from-cmdk");
  await page.getByRole("option", { name: /Create link for/ }).click();

  const dup = page.getByRole("dialog", { name: "This destination already has a link" });
  await expect(dup).toBeVisible();
  await dup.getByRole("button", { name: "Create separate link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
});
