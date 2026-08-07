import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, seedSubscriber } from "./db";

const password = "test-password-123";

/**
 * The number on one /admin stat card.
 *
 * Read as a delta rather than asserted outright: the local database keeps
 * whatever earlier runs left in it, so "MRR is $9" would depend on test
 * order. "Comping someone moves MRR by nothing" does not.
 */
async function stat(page: Page, label: string): Promise<number> {
  const card = page.getByText(label, { exact: true }).locator("..");
  const text = (await card.textContent()) ?? "";
  return Number(text.replace(label, "").replace(/[^0-9.-]/g, "")) || 0;
}

/**
 * A comp and a subscription grant the same access and are not the same fact
 * (#81), and only one of them is money (#82). This walks both through the
 * admin area, which is the only place the difference is visible.
 */
test("an admin can comp a user, and the comp never counts as revenue", async ({ page }) => {
  const subscriber = `playwright-sub-${Date.now()}@gmail.com`;
  const admin = `playwright-admin-${Date.now()}@gmail.com`;

  await signUpAndVerify(page, admin, password);
  await makePlatformAdmin(page, admin);
  // A real paying subscription: $9/mo, the way a Polar webhook leaves the row.
  await seedSubscriber(page, subscriber, "pro", 900);

  await page.goto("/admin/users");
  const subscriberRow = page.getByRole("row", { name: new RegExp(subscriber) });
  await expect(subscriberRow).toContainText("paid");

  // The admin's own row: free, and no subscription behind it.
  const adminRow = page.getByRole("row", { name: new RegExp(admin) });
  await expect(adminRow).toContainText("no subscription");

  // The seeded subscription is revenue: $9/mo of it.
  await page.goto("/admin");
  await expect(page.getByText("Subscribers", { exact: true })).toBeVisible();
  const before = {
    mrr: await stat(page, "MRR"),
    subscribers: await stat(page, "Subscribers"),
    comped: await stat(page, "Comped"),
  };
  expect(before.mrr).toBeGreaterThanOrEqual(9);

  // Comp the admin's own account. The reason is required, so the button
  // stays disabled until it is filled in.
  await page.goto("/admin/users");
  await adminRow.getByRole("button", { name: `Actions for` }).click();
  await page.getByRole("menuitem", { name: "Comp a paid plan" }).click();
  const dialog = page.getByRole("dialog", { name: /^Comp / });
  await expect(dialog.getByRole("button", { name: "Grant comp" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Design partner");
  await dialog.getByRole("button", { name: "Grant comp" }).click();

  await expect(page.getByText("Comp granted")).toBeVisible();
  await expect(adminRow).toContainText("comped");
  await expect(adminRow).toContainText("Design partner");
  await expect(adminRow).toContainText("pro");

  // Access went up. Revenue did not: one more comped user, same MRR and the
  // same subscriber count.
  await page.goto("/admin");
  await expect(page.getByText("Subscribers", { exact: true })).toBeVisible();
  expect(await stat(page, "Comped")).toBe(before.comped + 1);
  expect(await stat(page, "Subscribers")).toBe(before.subscribers);
  expect(await stat(page, "MRR")).toBe(before.mrr);

  // Revoking it takes the access away again, and leaves the subscriber alone.
  await page.goto("/admin/users");
  await adminRow.getByRole("button", { name: `Actions for` }).click();
  await page.getByRole("menuitem", { name: "Revoke comp" }).click();
  await expect(page.getByText("Comp revoked")).toBeVisible();
  await expect(adminRow).toContainText("no subscription");
  await expect(subscriberRow).toContainText("paid");
});
