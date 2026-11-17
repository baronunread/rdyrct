import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";

const password = "test-password-123";
const ALL = "Search links, pages and actions";
const LINKS = "Search your links";

async function freshPalette(page: Page, prefix: string) {
  await signUpAndVerify(page, `${prefix}-${Date.now()}@gmail.com`, password);
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+KeyK");
}

test("the command menu navigates and toggles the theme", async ({ page }) => {
  await freshPalette(page, "cmdk-nav");
  const input = page.getByPlaceholder(ALL);
  await expect(input).toBeFocused();
  await input.fill("links");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/links$/);
  await expect(input).toBeHidden();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(ALL).fill("theme");
  const before = await page.locator("html").getAttribute("data-theme");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator("html").getAttribute("data-theme")).not.toBe(before);
  await expect(page.getByPlaceholder(ALL)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder(ALL)).toBeHidden();
});

test("the palette finds links as you type, and Backspace pops the link pill", async ({ page }) => {
  await signUpAndVerify(page, `cmdk-links-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "https://example.com/palette-target");
  await page.getByRole("button", { name: /Close/i }).click();

  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette.getByText("Recent links")).toBeVisible();
  await expect(palette.getByRole("option").first()).toContainText("clicks");

  await page.getByPlaceholder(ALL).fill("palette");
  await expect(palette.getByText("Links", { exact: true })).toBeVisible();
  await expect(palette.locator("mark").first()).toHaveText(/palette/i);
  await expect(palette.getByText(/^\d+ results?$/)).toBeVisible();

  await palette.getByRole("option", { name: /Search all links for/ }).click();
  await expect(page.getByPlaceholder(LINKS)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear link filter" })).toBeVisible();

  await page.getByPlaceholder(LINKS).fill("palette-target");
  const result = palette
    .getByRole("option")
    .filter({ has: page.getByRole("button", { name: /^Copy https?:\/\// }) })
    .first();
  await expect(result).toBeVisible();
  await result.hover();

  await result.getByRole("button", { name: /^Copy https?:\/\// }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByPlaceholder(LINKS)).toBeVisible();

  await page.getByPlaceholder(LINKS).fill("");
  await page.keyboard.press("Backspace");
  await expect(page.getByPlaceholder(ALL)).toBeVisible();
});

test("the command menu creates a link, alias flow included", async ({ page }) => {
  await freshPalette(page, "cmdk-create");
  await page.getByPlaceholder(ALL).fill("https://example.com/from-cmdk");

  const create = page.getByRole("option", { name: /Create link for/ });
  await expect(create).toBeVisible();
  await create.click();

  const dialog = page.getByRole("dialog", { name: "Link created" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: /QR/i })).toBeVisible();
  await dialog.getByRole("button", { name: /Close/i }).click();
  await expect(dialog).toBeHidden();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(ALL).fill("https://example.com/from-cmdk");
  await page.getByRole("option", { name: /Create link for/ }).click();

  const dup = page.getByRole("dialog", { name: "This destination already has a link" });
  await expect(dup).toBeVisible();
  await dup.getByRole("button", { name: "Create separate link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
});

test("the palette shows a loader between the create click and the link", async ({ page }) => {
  await freshPalette(page, "cmdk-loader");
  await page.getByPlaceholder(ALL).fill("https://example.com/cmdk-loader");

  // Hold the create request open so the in-between state is observable.
  let release = () => {};
  await page.route("**/api/orgs/*/links", async (route) => {
    if (route.request().method() === "POST") await new Promise<void>((r) => (release = r));
    await route.continue();
  });

  await page.getByRole("option", { name: /Create link for/ }).click();

  await expect(page.getByPlaceholder(ALL)).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "Link created" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: /QR/i })).toBeHidden();

  release();
  await expect(dialog.getByRole("img", { name: /QR/i })).toBeVisible();
});

test("the palette's contextual create and invite actions", async ({ page }) => {
  await freshPalette(page, "cmdk-actions");

  const invitee = `invitee-${Date.now()}@gmail.com`;
  await page.getByPlaceholder(ALL).fill(invitee);
  await page.getByRole("option", { name: `Invite ${invitee}` }).click();
  await expect(page.getByText(`Invite sent to ${invitee}`)).toBeVisible();

  const here = page.url();
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByPlaceholder(ALL).fill("create link");
  await page.getByRole("option", { name: "Create link", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New link" })).toBeVisible();
  expect(page.url()).toBe(here);
});

test("G then a letter goes to a page, and ⌘K shows the keys", async ({ page }) => {
  await freshPalette(page, "cmdk-go");
  await page.getByPlaceholder(ALL).fill("links");
  await expect(page.getByRole("option", { name: "Links", exact: true })).toContainText("GL");
  await page.keyboard.press("Escape");

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(page).toHaveURL(/\/links$/);
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page).toHaveURL(/\/analytics$/);
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/dashboard$/);

  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(page).toHaveURL(/\/links$/);
});
