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
  return page.getByTitle("Switch organization").locator("span:not([aria-hidden])");
}

/** Opens the org switcher and creates another org under the same signed-in
 * account, for tests that share one user (see link-addresses.pw.ts) and so
 * have already left the no-org state behind by the time they need this.
 * Waits for the switch to settle, for the same reason as createOrg above. */
export async function createAdditionalOrg(page: Page, name: string) {
  await page.getByTitle("Switch organization").click();
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
  const dialog = page.getByRole("dialog", { name: "Add a domain" });
  await dialog.getByRole("textbox", { name: "Domain" }).fill(hostname);
  await dialog.getByRole("button", { name: "Add domain" }).click();
  await expect(dialog).toBeHidden();
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
  await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 30_000 });
  return added;
}

/** Opens the Links page's "New link" dialog and returns it. */
export async function openNewLinkDialog(page: Page) {
  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  return page.getByRole("dialog", { name: "New link" });
}

/** Creates a link from the dashboard (or the links page) and waits for the
 * confirmation dialog. On an org with no links yet the dashboard asks for the
 * first one with its own field; after that, the header's New link button
 * opens the New link dialog. Either way the same "Link created" dialog
 * answers. */
export async function createQuickLink(page: Page, destination: string) {
  const firstRunField = page.getByRole("textbox", { name: "Destination URL", exact: true });
  const newLinkButton = page.getByRole("button", { name: "New link" }).first();
  await expect(firstRunField.or(newLinkButton).first()).toBeVisible();
  if (await firstRunField.isVisible()) {
    await firstRunField.fill(destination);
    await page.getByRole("button", { name: "Create link" }).click();
  } else {
    await newLinkButton.click();
    const dialog = page.getByRole("dialog", { name: "New link" });
    await dialog.getByRole("textbox", { name: "Destination", exact: true }).fill(destination);
    await dialog.getByRole("button", { name: "Create link" }).click();
  }
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
