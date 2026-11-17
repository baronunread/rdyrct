import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { guestAccount, ownerWithInviteLink } from "./orgs";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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

  const uploaded = await guest.page.request.post("/api/user/avatar", {
    headers: { "content-type": "image/png" },
    data: Buffer.from(PNG_1x1, "base64"),
  });
  expect(uploaded.ok()).toBe(true);

  await page.goto("/members");
  const guestPicture = page
    .locator("tbody tr")
    .filter({ hasText: String(name) })
    .locator("img");
  await expect(guestPicture).toHaveAttribute("src", /^\/api\/orgs\/[^/]+\/members\/[^/]+\/avatar/);
  // Served to the owner, who is not the picture's account.
  await expect
    .poll(() => guestPicture.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    page.locator("tbody tr").filter({ hasText: owner }).first().locator("img"),
  ).toHaveAttribute("src", /^data:image\/svg\+xml/);

  await expect(page.getByRole("columnheader", { name: "Last active" })).toBeVisible();
  await expect(page.locator("tbody tr").getByText("Online now")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Change role for / })).toHaveCount(1);

  await page.getByRole("button", { name: `Change role for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Viewer" }).click();
  await expect(page.getByRole("button", { name: `Change role for ${name}` })).toContainText(
    "Viewer",
  );
  // The role menu fades out; until it has gone, its "Viewer" is a second match.
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.getByRole("button", { name: "More ways to invite" }).click();
  await page.getByRole("menuitem", { name: "Viewer", exact: true }).click();
  const inviteRow = page.locator("tbody tr").filter({ hasText: "Invite link" });
  await expect(inviteRow).toHaveCount(1);
  await inviteRow.getByRole("button", { name: "Revoke invite" }).click();
  await expect(inviteRow).toHaveCount(0);

  await page.getByRole("button", { name: `Remove ${name}` }).click();
  await page.getByRole("button", { name: "Remove member" }).click();
  await expect(page.locator("tbody tr").filter({ hasText: String(name) })).toHaveCount(0);

  await expect(page.getByText(/^Roles: Admins manage links/)).toHaveCount(0);

  await guest.context.close();
});
