import { queryRows } from "./db";
import { expect, type Browser, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const E2E_PASSWORD = "test-password-123";

/** Follows a short link once, without following the redirect, and checks it
 * sends the visitor to `destination`. */
export async function expectRedirect(page: Page, slug: string, destination: string) {
  const res = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe(destination);
}

/** The org name the sidebar's switcher shows, without the initial drawn
 * beside it (aria-hidden, so not part of the name). */
export function currentOrgName(page: Page) {
  return page.locator("[data-org-switcher]").first().locator("span:not([aria-hidden])");
}

/** Opens the org switcher and creates another org under the same signed-in
 * account, for tests that share one user (see link-addresses.pw.ts) and so
 * have already left the no-org state behind by the time they need this.
 * Waits for the switch to settle, for the same reason as createOrg above. */
export async function createAdditionalOrg(page: Page, name: string) {
  await page.locator("[data-org-switcher]").first().click();
  await page.getByRole("menuitem", { name: "New organization" }).click();
  const dialog = page.getByRole("dialog", { name: "New organization" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create organization" }).click();
  await expect(currentOrgName(page)).toHaveText(name);
}

/** Adds a custom domain from the Domains page and returns its hostname.
 * Does not wait for activation: callers that need "active" (DNS+TLS have
 * resolved against the fake Cloudflare backend) poll for that themselves,
 * since how long they're willing to wait varies by test. */
export async function addCustomDomain(page: Page, hostname = `e2e-${Date.now()}.example.com`) {
  await page.goto("/domains");
  await page.getByRole("button", { name: "Add domain" }).click();
  const field = page.getByRole("textbox", { name: "Domain", exact: true });
  await field.fill(hostname);
  await field.press("Enter");
  // The field closes back into the button, and the domain is a row.
  await expect(field).toBeHidden();
  await expect(page.getByText(hostname, { exact: true }).first()).toBeVisible();
  return hostname;
}

/** Adds a custom domain and waits for it to serve, for the tests that need a
 * working custom address rather than the act of adding one. The playwright
 * env reports DNS and TLS ready immediately (CF_DEV_ENV "instant"), so this
 * waits on one probe-ramp sleep plus a domains poll, not on the staged delays
 * local dev uses. Callers should mark themselves `test.slow()`: this alone can
 * take most of the default budget. */
export async function addActiveCustomDomain(page: Page, hostname?: string) {
  const added = await addCustomDomain(page, hostname);
  // The shared domain's row says Live too, so wait on this domain's row.
  const row = page.locator(`[data-domain="${added}"]`);
  await expect(row.getByText("Live", { exact: true })).toBeVisible({ timeout: 30_000 });
  return added;
}

/** Opens the Links page's "New link" dialog and returns it. */
export async function openNewLinkDialog(page: Page) {
  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  return page.getByRole("dialog", { name: "New link" });
}

/** Opens the New link form from the current page's header (the dashboard,
 * first run included, or the links page) and returns it. */
export async function openNewLinkForm(page: Page) {
  await page.getByRole("button", { name: "New link" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New link" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Creates a link through the New link form and waits for the "Link
 * created" dialog. */
export async function createQuickLink(page: Page, destination: string) {
  const dialog = await openNewLinkForm(page);
  await dialog.getByRole("textbox", { name: "Destination", exact: true }).fill(destination);
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
}

/**
 * Signs up an owner, creates a link invite from Members, and returns the
 * owner's address with the token behind it.
 *
 * The token is read back scoped to this owner, not as "the newest invite":
 * the suite runs in parallel shards against one database, so the globally
 * newest row belongs to whichever test wrote last.
 */
export async function ownerWithInviteLink(
  page: Page,
  prefix: string,
  /** Runs on the fresh dashboard, before the page leaves for Members: a
   * caller that needs the org to hold something has one chance to put it
   * there while the quick-create field is on screen. */
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
  // The open invite joins the members table as a row of its own.
  await expect(page.locator("tbody tr").filter({ hasText: "Invite link" })).toHaveCount(1);

  const [invite] = await queryRows<{ token: string }>(
    page,
    "select token from invites where created_by = (select id from user where email = ?)",
    [owner],
  );
  expect(invite?.token).toBeTruthy();
  return { owner, token: invite.token };
}

/** A separate signed-up account in its own browser context, for the half of
 * an invite flow the owner cannot play. */
export async function guestAccount(browser: Browser, prefix: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUpAndVerify(page, `${prefix}-${Date.now()}@gmail.com`, E2E_PASSWORD);
  return { context, page };
}
