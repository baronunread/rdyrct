import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";

const password = "test-password-123";

test("renaming a custom-domain link leaves a temporary alias, which can be kept forever (#38)", async ({
  page,
}) => {
  const email = `playwright-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email);

  await page.getByLabel("Organization name").fill("Alias Org");
  await page.getByRole("button", { name: "Create organization" }).click();

  // A custom domain is required: renaming only leaves an alias on a
  // custom-domain address, never on the shared, always-random domain.
  await page.goto("/domains");
  const hostname = `alias-${Date.now()}.example.com`;
  await page.getByPlaceholder("links.example.com").fill(hostname);
  await page.getByRole("button", { name: "Add domain" }).click();
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
  const email = `playwright-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  await page.getByLabel("Organization name").fill("Same Destination Org");
  await page.getByRole("button", { name: "Create organization" }).click();

  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await destination.fill("https://example.com/shared-page");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();

  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await editor
    .getByPlaceholder("https://example.com/launch")
    .fill("https://example.com/shared-page");
  await editor.getByRole("button", { name: "Create link" }).click();

  const conflict = page.getByRole("dialog", { name: "This destination already has a link" });
  await expect(conflict).toBeVisible();
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
  const email = `playwright-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  await page.getByLabel("Organization name").fill("Merge Org");
  await page.getByRole("button", { name: "Create organization" }).click();

  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await destination.fill("https://example.com/merge-page");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();

  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await editor
    .getByPlaceholder("https://example.com/launch")
    .fill("https://example.com/merge-page");
  await editor.getByRole("button", { name: "Create link" }).click();

  const conflict = page.getByRole("dialog", { name: "This destination already has a link" });
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "Add to existing link" }).click();
  await expect(page.getByText("Address added to the existing link")).toBeVisible();

  // Still one link: the second address became an alias on it, not a fork.
  await page.goto("/links");
  await expect(page.getByText("1 / 30 links")).toBeVisible();
});
