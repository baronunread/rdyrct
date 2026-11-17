import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setOrgsOverride, setPlan } from "./db";
import {
  addActiveCustomDomain,
  createAdditionalOrg,
  createQuickLink,
  openNewLinkDialog,
} from "./orgs";

const password = "test-password-123";
const authFile = join(mkdtempSync(join(tmpdir(), "rdyrct-e2e-")), "auth.json");

// A sign-up per test would trip the email-send rate limit (3/60s, shared by
// the whole e2e run), so this file signs up once and reuses the session.
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile });

test.beforeAll(async ({ browser }) => {
  // `test.use({ storageState })` below also applies to newContext(); reset it,
  // since this context creates that file.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const email = `playwright-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  // More than one org is an admin-set Enterprise allowance; each test wants
  // a fresh, empty org. Pro is for the custom domain the alias tests add.
  await setPlan(page, email, "pro");
  await setOrgsOverride(page, email, 3);
  await context.storageState({ path: authFile });
  await context.close();
});

// The first test to ask for a fresh org gets the sign-up org; the rest make
// their own. Module state is safe because this file runs serially.
let defaultOrgSpent = false;

async function freshOrg(page: Page, name: string): Promise<void> {
  await page.goto("/dashboard");
  await expect(page.locator("[data-org-switcher]").first()).toBeVisible();
  if (defaultOrgSpent) {
    await createAdditionalOrg(page, name);
  } else {
    defaultOrgSpent = true;
  }
  // Wait for the dashboard's New link, not network idle: product analytics
  // can keep an unrelated request open.
  await expect(page.getByRole("button", { name: "New link" }).first()).toBeVisible();
}

async function createLinkExpectingConflict(page: Page, destination: string) {
  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await editor.getByPlaceholder("https://example.com/launch").fill(destination);
  await editor.getByRole("button", { name: "Create link" }).click();

  const conflict = page.getByRole("dialog", { name: "This destination already has a link" });
  await expect(conflict).toBeVisible();
  return conflict;
}

test("renaming a custom-domain link leaves a temporary alias, which can be made permanent (#38)", async ({
  page,
}) => {
  // The custom-domain activation wait below can alone take up to 30s, the
  // default test budget: give this one more room.
  test.slow();
  await freshOrg(page, "Alias Org");

  // Renaming leaves an alias only on a custom domain, never the shared one.
  const hostname = await addActiveCustomDomain(page, `alias-${Date.now()}.example.com`);

  const editor = await openNewLinkDialog(page);
  await editor.getByPlaceholder("https://example.com/launch").fill("https://example.com/original");
  // exact: the Slug hint ("Use a custom domain...") also matches "Domain".
  await editor.getByLabel("Domain", { exact: true }).click();
  await page.getByRole("menuitem", { name: hostname }).click();
  await editor.getByPlaceholder("launch-2026").fill("old-slug");
  await editor.getByRole("button", { name: "Create link" }).click();
  const created = page.getByRole("dialog", { name: "Link created" });
  await expect(created).toContainText(`${hostname}/old-slug`);
  await page.keyboard.press("Escape");
  await expect(created).toBeHidden();
  await expect(page.getByText(`${hostname}/old-slug`)).toBeVisible();

  await page
    .getByRole("row", { name: /old-slug/ })
    .getByRole("button", { name: "Actions for old-slug" })
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const renameEditor = page.getByRole("dialog", { name: "Edit link" });
  await renameEditor.getByPlaceholder("launch-2026").fill("new-slug");
  await renameEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${hostname}/new-slug`)).toBeVisible();

  await page
    .getByRole("row", { name: /new-slug/ })
    .getByRole("button", { name: "Actions for new-slug" })
    .click();
  await page.getByRole("menuitem", { name: "Add another short link" }).click();
  const aliasDialog = page.getByRole("dialog", { name: "Create alias" });
  await aliasDialog.getByPlaceholder("promo-2026").fill("kept-slug");
  await aliasDialog.getByRole("button", { name: "Create alias" }).click();
  await expect(aliasDialog).toBeHidden();

  const toggle = page.getByRole("button", { name: "Show 2 aliases" });
  await expect(toggle).toContainText("+2");
  await toggle.click();
  const aliasRows = page.locator("tr.alias-row");
  await expect(aliasRows).toHaveCount(2);
  await expect(aliasRows.nth(0)).toContainText("/old-slug");
  await expect(aliasRows.nth(0)).toContainText(/\d+h left/);
  await expect(aliasRows.nth(0)).not.toContainText(hostname);
  await expect(aliasRows.nth(1)).toContainText("/kept-slug");
  await expect(aliasRows.nth(1)).not.toContainText(/left|Keep/);
  await expect(page.getByText(/Permanent alias|Same destination|Alias clicks count/)).toHaveCount(
    0,
  );

  const keep = aliasRows.nth(0).getByRole("button", { name: "Keep old-slug for good" });
  await keep.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Kept old-slug")).toBeVisible();
  await expect(page.locator("tr.alias-row", { hasText: "/old-slug" })).not.toContainText(
    /left|Keep/,
  );

  const menu = page
    .locator("tr.alias-row", { hasText: "/old-slug" })
    .getByRole("button", { name: "Actions for old-slug" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Make primary" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
});

test("creating a link to an already-shortened destination offers to reuse it (#38)", async ({
  page,
}) => {
  await freshOrg(page, "Same Destination Org");
  await createQuickLink(page, "https://example.com/shared-page");

  const conflict = await createLinkExpectingConflict(page, "https://example.com/shared-page");
  await conflict.getByRole("button", { name: "Create separate link" }).click();
  await expect(page.getByText("Link created")).toBeVisible();

  // Two distinct links, not one with a merged address. A "links" count cannot
  // tell fork from merge: a kept alias also counts toward it.
  await page.goto("/links");
  await expect(page.locator("tbody tr")).toHaveCount(2);
});

test("choosing to add to the existing link merges the address instead of forking (#38)", async ({
  page,
}) => {
  await freshOrg(page, "Merge Org");
  await createQuickLink(page, "https://example.com/merge-page");

  const conflict = await createLinkExpectingConflict(page, "https://example.com/merge-page");
  await conflict.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("dialog", { name: "Address added" })).toBeVisible();

  await page.goto("/links");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Show 1 alias" })).toBeVisible();
});
