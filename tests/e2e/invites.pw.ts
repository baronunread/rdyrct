import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows } from "./db";

const password = "test-password-123";

/**
 * An accepted invite leaves no row behind (#103).
 *
 * The row held a live token and, for an email invite, the address it was sent
 * to. Nothing ever read that history: every reader filtered it back out, so
 * the retention bought nothing and cost an address belonging to somebody who
 * may never have signed up.
 */
test("accepting an invite deletes it, token and all", async ({ page, browser }) => {
  const owner = `owner-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, owner, password);

  await page.goto("/members");
  await page.getByRole("button", { name: "Invite link" }).click();
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByText("Pending invites")).toBeVisible();

  // Scoped to this owner, not "the newest invite": the suite runs in parallel
  // shards against one database, so the global newest row belongs to whichever
  // test wrote last.
  const [invite] = await queryRows<{ token: string }>(
    page,
    "select token from invites where created_by = (select id from user where email = ?)",
    [owner],
  );
  expect(invite?.token).toBeTruthy();

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await signUpAndVerify(guestPage, `guest-${Date.now()}@gmail.com`, password);
  await guestPage.goto(`/invite/${invite.token}`);
  await guestPage.getByRole("button", { name: "Accept invite" }).click();
  await expect(guestPage).toHaveURL(/\/dashboard$/);

  const rows = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from invites where token = ?",
    [invite.token],
  );
  expect(rows[0].n).toBe(0);

  // And the spent token now answers exactly like one that never existed, so
  // nothing learns which tokens were real.
  await guestPage.goto(`/invite/${invite.token}`);
  await expect(guestPage.getByText("This invite is invalid or has expired.")).toBeVisible();

  // The owner's pending list is empty too: it no longer filters accepted rows
  // out, there are none to filter.
  await page.goto("/members");
  await expect(page.getByText("Pending invites")).toBeHidden();

  await guest.close();
});
