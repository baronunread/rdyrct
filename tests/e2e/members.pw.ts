import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { guestAccount, ownerWithInviteLink } from "./orgs";

/**
 * The members table (the redesign): the role is changed where it is shown,
 * removing someone is a trash in their row, and an open invite sits in the
 * same table as the people, with its own copy and revoke.
 */
test("change a role in place, revoke an invite from its row, remove a member", async ({
  page,
  browser,
}) => {
  const { owner, token } = await ownerWithInviteLink(page, "members-owner");

  const guest = await guestAccount(browser, "members-guest");
  await guest.page.goto(`/invite/${token}`);
  await guest.page.getByRole("button", { name: "Accept invite" }).click();
  await expect(guest.page).toHaveURL(/\/dashboard$/);
  const guestName = await queryRows<{ name: string }>(
    page,
    `select u.name from org_members m join user u on u.id = m.user_id
     where m.org_id = (select m2.org_id from org_members m2 join user u2 on u2.id = m2.user_id
                       where u2.email = ? and m2.role = 'owner')
       and m.role <> 'owner'`,
    [owner],
  );
  const name = guestName[0]?.name;
  expect(name).toBeTruthy();

  await page.goto("/members");
  // The owner's own role is not a control.
  await expect(page.getByRole("button", { name: /^Change role for / })).toHaveCount(1);

  await page.getByRole("button", { name: `Change role for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Viewer" }).click();
  await expect(page.getByRole("button", { name: `Change role for ${name}` })).toContainText(
    "Viewer",
  );

  // A second invite, made from the chevron, then revoked from its row.
  await page.getByRole("button", { name: "More ways to invite" }).click();
  await page.getByRole("menuitem", { name: "Viewer", exact: true }).click();
  const inviteRow = page.locator("tbody tr").filter({ hasText: "Invite link" });
  await expect(inviteRow).toHaveCount(1);
  await inviteRow.getByRole("button", { name: "Revoke invite" }).click();
  await expect(inviteRow).toHaveCount(0);

  // The trash in the row asks first, then removes.
  await page.getByRole("button", { name: `Remove ${name}` }).click();
  await page.getByRole("button", { name: "Remove member" }).click();
  await expect(page.locator("tbody tr").filter({ hasText: String(name) })).toHaveCount(0);

  // The footnote says what each role can do.
  await expect(page.getByText(/^Roles: Admins manage links, domains and members\./)).toBeVisible();

  await guest.context.close();
});
