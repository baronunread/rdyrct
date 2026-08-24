import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { createQuickLink, guestAccount, ownerWithInviteLink } from "./orgs";

/**
 * A viewer sees the org and can change none of it (#157).
 *
 * The server refuses their writes with a 403, so the app must not offer them:
 * a control whose only outcome is an error toast is not a feature. This walks
 * the screens a viewer actually lands on and asserts the read is there and
 * the write is not.
 */
test("a viewer reads the links and the numbers, and is offered no way to change them", async ({
  page,
  browser,
}) => {
  const { owner, token } = await ownerWithInviteLink(page, "vowner", async (owned) => {
    await createQuickLink(owned, "example.com/viewer-sees-this");
  });

  // Created as a member by default; make it a viewer directly, since the
  // point under test is the role, not the picker.
  await queryRows(
    page,
    "update invites set role = 'viewer' where created_by = (select id from user where email = ?)",
    [owner],
  );

  const guest = await guestAccount(browser, "analyst");
  const viewer = guest.page;
  await viewer.goto(`/invite/${token}`);
  await viewer.getByRole("button", { name: "Accept invite" }).click();
  await expect(viewer).toHaveURL(/\/dashboard$/);

  // Switch to the org they were invited to, then read what it holds.
  await viewer.goto("/links");
  await expect(viewer.getByText("viewer-sees-this")).toBeVisible({ timeout: 15_000 });

  // The read is there; the write is not.
  await expect(viewer.getByRole("button", { name: "New link" })).toBeHidden();

  await viewer.getByRole("button", { name: /Actions for/ }).click();
  await expect(viewer.getByRole("menuitem", { name: /View analytics/ })).toBeVisible();
  await expect(viewer.getByRole("menuitem", { name: /Edit/ })).toBeHidden();
  await expect(viewer.getByRole("menuitem", { name: /Delete/ })).toBeHidden();
  await viewer.keyboard.press("Escape");

  // Analytics is a read, so it stays open to them.
  await viewer.goto("/analytics");
  await expect(viewer.getByRole("heading", { name: /Analytics/i })).toBeVisible();

  await guest.context.close();
});
