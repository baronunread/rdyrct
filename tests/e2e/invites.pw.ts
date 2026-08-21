import { expect, test, type Browser, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows } from "./db";

const password = "test-password-123";

/**
 * Signs up an owner, creates a link invite from Members, and returns the
 * owner's address with the token behind it.
 *
 * The token is read back scoped to this owner, not as "the newest invite":
 * the suite runs in parallel shards against one database, so the globally
 * newest row belongs to whichever test wrote last.
 */
async function ownerWithInviteLink(page: Page, prefix: string) {
  const owner = `${prefix}-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, owner, password);

  await page.goto("/members");
  await page.getByRole("button", { name: "Invite link" }).click();
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByText("Pending invites")).toBeVisible();

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
async function guestAccount(browser: Browser, prefix: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUpAndVerify(page, `${prefix}-${Date.now()}@gmail.com`, password);
  return { context, page };
}

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

  // The owner's pending list is empty too: it no longer filters accepted rows
  // out, there are none to filter.
  await page.goto("/members");
  await expect(page.getByText("Pending invites")).toBeHidden();

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

  const first = await guestAccount(browser, "first");
  await first.page.goto(`/invite/${token}`);
  await first.page.getByRole("button", { name: "Accept invite" }).click();
  await expect(first.page).toHaveURL(/\/dashboard$/);

  const second = await guestAccount(browser, "second");
  await second.page.goto(`/invite/${token}`);
  await expect(second.page.getByText("This invite is invalid or has expired.")).toBeVisible();

  await first.context.close();
  await second.context.close();
});
