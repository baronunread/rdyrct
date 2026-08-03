import { expect, type Page, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { addCustomDomain, createOrg } from "./orgs";

const password = "test-password-123";

/** Signs up a fresh user, verifies their email, and creates an org: the
 * common setup every test in this file needs before it can create links. */
async function signUpWithOrg(page: Page, orgName: string): Promise<string> {
  const email = `playwright-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await createOrg(page, orgName);
  return email;
}

/** Fills the dashboard's quick-create destination field and submits it,
 * waiting for the "Link created" confirmation dialog. */
async function createQuickLink(page: Page, destination: string) {
  const field = page.getByPlaceholder("https://example.com/launch").first();
  await field.fill(destination);
  await page.getByRole("button", { name: "Create link" }).click();
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
  const email = await signUpWithOrg(page, "Alias Org");
  await setPlan(page, email);

  // A custom domain is required: renaming only leaves an alias on a
  // custom-domain address, never on the shared, always-random domain.
  const hostname = await addCustomDomain(page, `alias-${Date.now()}.example.com`);
  await expect(page.getByText("active", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await editor.getByPlaceholder("https://example.com/launch").fill("https://example.com/original");
  await editor.getByLabel("Domain").click();
  await page.getByRole("menuitem", { name: hostname }).click();
  await editor.getByPlaceholder("launch-2026").fill("old-slug");
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText(`${hostname}/old-slug`)).toBeVisible();

  // Rename the slug from the inline edit action.
  await page
    .getByRole("row", { name: /old-slug/ })
    .getByLabel("Edit")
    .click();
  const renameEditor = page.getByRole("dialog", { name: "Edit link" });
  await renameEditor.getByPlaceholder("launch-2026").fill("new-slug");
  await renameEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${hostname}/new-slug`)).toBeVisible();

  // Open the link's detail page and check the Addresses card.
  await page.getByText(`${hostname}/new-slug`).click();
  await expect(page).toHaveURL(/\/links\/new-slug/);
  const addresses = page.getByText("Addresses", { exact: true }).locator("..");
  await expect(addresses.getByText("Primary", { exact: true })).toBeVisible();
  await expect(addresses.getByText(/Expires in/)).toBeVisible();
  await expect(addresses.getByText(hostname + "/old-slug")).toBeVisible();

  // Keep the temporary alias forever.
  await page.getByRole("button", { name: "Keep forever" }).click();
  await expect(page.getByText("Address kept forever")).toBeVisible();
  await expect(addresses.getByText("Permanent alias")).toBeVisible();
  await expect(addresses.getByText(/Expires in/)).not.toBeVisible();
});

test("creating a link to an already-shortened destination offers to reuse it (#38)", async ({
  page,
}) => {
  await signUpWithOrg(page, "Same Destination Org");
  await createQuickLink(page, "https://example.com/shared-page");

  const conflict = await createLinkExpectingConflict(page, "https://example.com/shared-page");
  await conflict.getByRole("button", { name: "Create separate link" }).click();
  await expect(page.getByText("Link created")).toBeVisible();

  // Two distinct links now exist (the dashboard quick-create plus this one),
  // not a single link with a merged address.
  await page.goto("/links");
  await expect(page.getByText("2 / 30 links")).toBeVisible();
});

test("choosing to add to the existing link merges the address instead of forking (#38)", async ({
  page,
}) => {
  await signUpWithOrg(page, "Merge Org");
  await createQuickLink(page, "https://example.com/merge-page");

  const conflict = await createLinkExpectingConflict(page, "https://example.com/merge-page");
  await conflict.getByRole("button", { name: "Add to existing link" }).click();
  await expect(page.getByText("Address added to the existing link")).toBeVisible();

  // Still one link: the second address became an alias on it, not a fork.
  await page.goto("/links");
  await expect(page.getByText("1 / 30 links")).toBeVisible();
});
