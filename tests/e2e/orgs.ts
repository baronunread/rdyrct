import { queryRows, setPlan } from "./db";
import { expect, type Browser, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const E2E_PASSWORD = "test-password-123";

export async function expectRedirect(page: Page, slug: string, destination: string) {
  const res = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe(destination);
}

/** The sidebar switcher's org name, without the aria-hidden initial. */
export function currentOrgName(page: Page) {
  return page.locator("[data-org-switcher]").first().locator("span:not([aria-hidden])");
}

export async function createAdditionalOrg(page: Page, name: string) {
  await page.locator("[data-org-switcher]").first().click();
  await page.getByRole("menuitem", { name: "New organization" }).click();
  const dialog = page.getByRole("dialog", { name: "New organization" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create organization" }).click();
  await expect(currentOrgName(page)).toHaveText(name);
}

export async function addCustomDomain(page: Page, hostname = `e2e-${Date.now()}.example.com`) {
  await page.goto("/domains");
  await page.getByRole("button", { name: "Add domain" }).click();
  const field = page.getByRole("textbox", { name: "Domain", exact: true });
  await field.fill(hostname);
  await field.press("Enter");
  await expect(field).toBeHidden();
  await expect(page.getByText(hostname, { exact: true }).first()).toBeVisible();
  return hostname;
}

/** The playwright env reports DNS and TLS ready at once (CF_DEV_ENV "instant"),
 * but this can still take most of the default budget: callers mark
 * themselves `test.slow()`. */
export async function addActiveCustomDomain(page: Page, hostname?: string) {
  const added = await addCustomDomain(page, hostname);
  // The shared domain's row says Live too, so wait on this domain's row.
  const row = page.locator(`[data-domain="${added}"]`);
  await expect(row.getByText("Live", { exact: true })).toBeVisible({ timeout: 30_000 });
  return added;
}

export async function signUpProWithDomain(page: Page, email: string, password: string) {
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro");
  return addActiveCustomDomain(page);
}

export async function openNewLinkDialog(page: Page) {
  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  return page.getByRole("dialog", { name: "New link" });
}

export async function openNewLinkForm(page: Page) {
  await page.getByRole("button", { name: "New link" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New link" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function createQuickLink(page: Page, destination: string) {
  const dialog = await openNewLinkForm(page);
  await dialog.getByRole("textbox", { name: "Destination", exact: true }).fill(destination);
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
}

export async function signUpWithLiveLink(page: Page, prefix: string) {
  await signUpAndVerify(page, `${prefix}-${Date.now()}@gmail.com`, E2E_PASSWORD);
  const destination = `https://example.com/${prefix}-${Date.now()}`;
  await createQuickLink(page, destination);
  const [{ slug }] = await queryRows<{ slug: string }>(
    page,
    "select slug from links where destination = ?",
    [destination],
  );
  await expectRedirect(page, slug, destination);
  return { slug, destination };
}

/**
 * The token is read back scoped to this owner, not as "the newest invite":
 * shards share one database, so the newest row is whoever wrote last.
 */
export async function ownerWithInviteLink(
  page: Page,
  prefix: string,
  seed?: (page: Page) => Promise<void>,
) {
  const owner = `${prefix}-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, owner, E2E_PASSWORD);
  await seed?.(page);

  await page.goto("/members");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Invite people" })
    .getByRole("button", { name: "Copy invite link" })
    .click();
  await expect(page.locator("tbody tr").filter({ hasText: "Invite link" })).toHaveCount(1);

  const [invite] = await queryRows<{ token: string }>(
    page,
    "select token from invites where created_by = (select id from user where email = ?)",
    [owner],
  );
  expect(invite?.token).toBeTruthy();
  return { owner, token: invite.token };
}

export async function guestAccount(browser: Browser, prefix: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUpAndVerify(page, `${prefix}-${Date.now()}@gmail.com`, E2E_PASSWORD);
  return { context, page };
}
