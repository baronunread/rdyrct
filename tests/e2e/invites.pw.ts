import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { guestAccount, ownerWithInviteLink } from "./orgs";

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
