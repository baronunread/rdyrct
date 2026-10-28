import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { guestAccount, ownerWithInviteLink } from "./orgs";
import { signUpAndVerify } from "./resend";

/**
 * An accepted invite leaves no row behind (#103).
 *
 * The row held a live token and, for an email invite, the address it was sent
 * to. Nothing ever read that history: every reader filtered it back out, so
 * the retention bought nothing and cost an address belonging to somebody who
 * may never have signed up.
 */
test("accepting an invite deletes it, token and all", async ({ page, browser }) => {
  const { token } = await ownerWithInviteLink(page, "owner");

  const guest = await guestAccount(browser, "guest");
  await guest.page.goto(`/invite/${token}`);
  await guest.page.getByRole("button", { name: "Accept invite" }).click();
  await expect(guest.page).toHaveURL(/\/dashboard$/);

  const rows = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from invites where token = ?",
    [token],
  );
  expect(rows[0].n).toBe(0);

  // And the spent token now answers exactly like one that never existed, so
  // nothing learns which tokens were real.
  await guest.page.goto(`/invite/${token}`);
  await expect(guest.page.getByText("This invite is invalid or has expired.")).toBeVisible();

  // The owner's table has no invite row left either: it no longer filters
  // accepted rows out, there are none to filter.
  await page.goto("/members");
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toBeVisible();
  await expect(page.locator("tbody tr").filter({ hasText: "Invite link" })).toHaveCount(0);

  await guest.context.close();
});

/**
 * The link says single-use, so it admits one person (#154).
 *
 * Two accounts open the same token. Whoever gets there first joins; the other
 * reads the same "invalid or expired" as somebody who invented a token, which
 * is the honest answer once the link has been spent.
 */
test("a single-use invite link admits one person, not everybody who has it", async ({
  page,
  browser,
}) => {
  const { token } = await ownerWithInviteLink(page, "single");

  // Both open the live link before either accepts, so the second one is
  // holding a card that has already gone stale by the time they click.
  const first = await guestAccount(browser, "first");
  const second = await guestAccount(browser, "second");
  await first.page.goto(`/invite/${token}`);
  await second.page.goto(`/invite/${token}`);
  await expect(second.page.getByRole("button", { name: "Accept invite" })).toBeVisible();

  await first.page.getByRole("button", { name: "Accept invite" }).click();
  await expect(first.page).toHaveURL(/\/dashboard$/);

  await second.page.getByRole("button", { name: "Accept invite" }).click();
  await expect(second.page.getByText("Invite not found or expired")).toBeVisible();
  // And the card stops offering a button that cannot work.
  await expect(second.page.getByText("This invite is invalid or has expired.")).toBeVisible();

  await first.context.close();
  await second.context.close();
});

/**
 * Signing in from an invite comes back to the invite.
 *
 * "Sign in to accept" sends a signed-out visitor to /login?next=/invite/…, and
 * sign-in navigated there. But the login page rendered once more before it
 * unmounted, read the now-empty query string, and replaced the invite with
 * /dashboard, so the person never joined. Every `next` was lost the same way.
 */
test("signing in from an invite lands back on the invite", async ({ page, browser }) => {
  const { token } = await ownerWithInviteLink(page, "next-owner");

  const context = await browser.newContext();
  const guest = await context.newPage();
  const email = `next-guest-${Date.now()}@gmail.com`;
  await signUpAndVerify(guest, email, "test-password-123");
  await context.clearCookies();

  await guest.goto(`/invite/${token}`);
  await guest.getByRole("button", { name: "Sign in to accept" }).click();
  await expect(guest).toHaveURL(/\/login\?next=/);
  await guest.getByLabel("Email").fill(email);
  await guest.getByLabel("Password").fill("test-password-123");
  await guest.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(guest).toHaveURL(new RegExp(`/invite/${token}$`));
  await guest.getByRole("button", { name: "Accept invite" }).click();
  await expect(guest).toHaveURL(/\/dashboard$/);

  const rows = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from org_members m join user u on u.id = m.user_id where u.email = ?",
    [email],
  );
  // Their own org from sign-up, plus the one they were invited to.
  expect(rows[0].n).toBe(2);

  await context.close();
});
