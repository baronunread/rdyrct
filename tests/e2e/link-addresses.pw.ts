import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { addCustomDomain, createAdditionalOrg, createOrg } from "./orgs";

const password = "test-password-123";
const authFile = join(mkdtempSync(join(tmpdir(), "rdyrct-e2e-")), "auth.json");

// Every test below needs its own empty org, but a fresh sign-up per test
// trips the email-send rate limit (3/60s, shared across the whole e2e run).
// So this file signs up once here and every test reuses that session.
test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile });

test.beforeAll(async ({ browser }) => {
  // `test.use({ storageState: authFile })` below also applies to
  // browser.newContext() defaults, so override it back to none here: this
  // context is what *creates* that file, it can't start from it.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const email = `playwright-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  // Pro: the only plan that allows owning more than one org (AGENTS.md),
  // which every test here needs since they each want a fresh, empty org.
  await setPlan(page, email, "pro");
  await context.storageState({ path: authFile });
  await context.close();
});

/** Creates a fresh, empty org under the shared signed-in user. The first
 * call lands on the no-org state; later calls go through the org switcher. */
async function freshOrg(page: Page, name: string): Promise<void> {
  await page.goto("/dashboard");
  // The switcher lives in the shell and renders either way (as "No
  // organization" pre-first-org), so it's a reliable signal the shell (and
  // so the no-org heading it's paired with, if applicable) has rendered.
  await expect(page.getByTitle("Switch organization")).toBeVisible();
  const noOrgHeading = page.getByRole("heading", { name: "Create your organization" });
  if (await noOrgHeading.isVisible()) {
    await createOrg(page, name);
  } else {
    await createAdditionalOrg(page, name);
  }
  // Switching org invalidates the dashboard's queries, which briefly
  // remounts it into its loading skeleton: settle before touching its form,
  // so a fill() right after doesn't land in a field about to be replaced.
  await page.waitForLoadState("networkidle");
}

/** Fills the dashboard's quick-create destination field and submits it,
 * waiting for the "Link created" confirmation dialog. */
async function createQuickLink(page: Page, destination: string) {
  const field = page.getByPlaceholder("https://example.com/launch").first();
  const button = page.getByRole("button", { name: "Create link" });
  // Right after switching org, the dashboard's data queries can still be
  // settling and remount the form underneath a fill(): keep re-filling
  // until it actually sticks (and so the submit button un-disables) rather
  // than trusting a single fill call landed in the final instance.
  await expect(async () => {
    await field.fill(destination);
    await expect(button).toBeEnabled();
  }).toPass();
  await button.click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
}

/** Fills the "New link" dialog with `destination` and submits it, for tests
 * that expect the same-destination conflict dialog to show up. */
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

test("renaming a custom-domain link leaves a temporary alias, which can be kept forever (#38)", async ({
  page,
}) => {
  // The custom-domain activation wait below can alone take up to 30s, the
  // default test budget: give this one more room.
  test.slow();
  await freshOrg(page, "Alias Org");

  // A custom domain is required: renaming only leaves an alias on a
  // custom-domain address, never on the shared, always-random domain.
  const hostname = await addCustomDomain(page, `alias-${Date.now()}.example.com`);
  // The playwright env reports DNS and TLS ready immediately (CF_DEV_ENV
  // "instant"), so this waits on one probe-ramp sleep plus a domains poll, not
  // on the staged delays local dev uses.
  await expect(page.getByText("active", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await editor.getByPlaceholder("https://example.com/launch").fill("https://example.com/original");
  // exact: the Slug field's hint text ("Use a custom domain for custom
  // slugs.") also matches "Domain" as a substring once a domain is added.
  await editor.getByLabel("Domain", { exact: true }).click();
  await page.getByRole("menuitem", { name: hostname }).click();
  await editor.getByPlaceholder("launch-2026").fill("old-slug");
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText(`${hostname}/old-slug`)).toBeVisible();

  // Rename the slug from the row's actions menu.
  await page
    .getByRole("row", { name: /old-slug/ })
    .getByRole("button", { name: "Actions for old-slug" })
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const renameEditor = page.getByRole("dialog", { name: "Edit link" });
  await renameEditor.getByPlaceholder("launch-2026").fill("new-slug");
  await renameEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${hostname}/new-slug`)).toBeVisible();

  // Expand the alias thread and check the temporary alias it left behind.
  await page.getByRole("button", { name: /Show \d+ alias/ }).click();
  const aliasRow = page.getByRole("row", { name: /old-slug/ });
  await expect(aliasRow.getByText(/Expires in/)).toBeVisible();

  // Keep the temporary alias forever, from its own row actions menu.
  await aliasRow.getByRole("button", { name: "Actions for old-slug" }).click();
  await page.getByRole("menuitem", { name: "Keep forever" }).click();
  await expect(page.getByText("Address kept forever")).toBeVisible();
  await expect(aliasRow.getByText("Permanent alias")).toBeVisible();
  await expect(aliasRow.getByText(/Expires in/)).not.toBeVisible();
});

test("creating a link to an already-shortened destination offers to reuse it (#38)", async ({
  page,
}) => {
  await freshOrg(page, "Same Destination Org");
  await createQuickLink(page, "https://example.com/shared-page");

  const conflict = await createLinkExpectingConflict(page, "https://example.com/shared-page");
  await conflict.getByRole("button", { name: "Create separate link" }).click();
  await expect(page.getByText("Link created")).toBeVisible();

  // Two distinct links now exist (the dashboard quick-create plus this one),
  // not a single link with a merged address. (Not a "links" count check: a
  // kept alias also counts toward that limit, so it can't tell fork from
  // merge apart on its own — see the next test.)
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
  await expect(page.getByText("Address added to the existing link")).toBeVisible();

  // Still one link: the second address became an alias on it, not a fork.
  await page.goto("/links");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Show 1 alias" })).toBeVisible();
});
