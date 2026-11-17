import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { createQuickLink, guestAccount, ownerWithInviteLink } from "./orgs";

test("a viewer reads the links and the numbers, and is offered no way to change them", async ({
  page,
  browser,
}) => {
  const { owner, token } = await ownerWithInviteLink(page, "vowner", async (owned) => {
    await createQuickLink(owned, "example.com/viewer-sees-this");
  });

  // Made a viewer directly: the role is under test, not the picker.
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

  await viewer.goto("/links");
  await expect(viewer.getByText("viewer-sees-this")).toBeVisible({ timeout: 15_000 });

  await expect(viewer.getByRole("button", { name: "New link" })).toBeHidden();

  await viewer.getByRole("button", { name: /Actions for/ }).click();
  await expect(viewer.getByRole("menuitem", { name: "Analytics" })).toBeVisible();
  await expect(viewer.getByRole("menuitem", { name: "QR code" })).toBeVisible();
  await expect(viewer.getByRole("menuitem", { name: /Edit/ })).toBeHidden();
  await expect(viewer.getByRole("menuitem", { name: /Delete/ })).toBeHidden();
  await viewer.keyboard.press("Escape");

  await viewer
    .getByRole("checkbox", { name: /^Select / })
    .first()
    .check();
  const bar = viewer.getByRole("toolbar", { name: "Selected links" });
  await expect(bar.getByRole("button", { name: /QR codes/ })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Delete" })).toBeHidden();

  await viewer.goto("/analytics");
  await expect(viewer.getByRole("heading", { name: /Analytics/i })).toBeVisible();

  await guest.context.close();
});
