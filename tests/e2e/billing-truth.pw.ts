import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, seedSubscriber } from "./db";

const password = "test-password-123";

/**
 * The number on one /admin stat card.
 *
 * Read as a delta rather than asserted outright: the local database keeps
 * whatever earlier runs left in it, so "there are 3 subscribers" would depend
 * on test order. "Comping someone adds no subscriber" does not.
 */
async function stat(page: Page, label: string): Promise<number> {
  const card = page.getByText(label, { exact: true }).locator("..");
  const text = (await card.textContent()) ?? "";
  return Number(text.replace(label, "").replace(/[^0-9.-]/g, "")) || 0;
}

/** The comped count, which sits in the plan-mix card's footnote rather than
 * on a card of its own: a comp is not a fourth plan, it is how some of the
 * paid rows were paid for. */
async function compedCount(page: Page): Promise<number> {
  const line = await page.getByText(/\d+ comped/).textContent();
  return Number(/(\d+) comped/.exec(line ?? "")?.[1] ?? NaN);
}

/**
 * A comp and a subscription grant the same access and are not the same fact
 * (#81), and only one of them is somebody paying (#82). This walks both
 * through the admin area, which is the only place the difference is visible.
 */
test("an admin can comp a user, and the comp never counts as a subscriber", async ({ page }) => {
  const subscriber = `playwright-sub-${Date.now()}@gmail.com`;
  const admin = `playwright-admin-${Date.now()}@gmail.com`;

  await signUpAndVerify(page, admin, password);
  await makePlatformAdmin(page, admin);
  // A real paying subscription, the way a Polar webhook leaves the row.
  await seedSubscriber(page, subscriber, "pro");

  await page.goto("/admin/users");
  const subscriberRow = page.getByRole("row", { name: new RegExp(subscriber) });
  await expect(subscriberRow).toContainText("paid");

  // The admin's own row: free, and no subscription behind it.
  const adminRow = page.getByRole("row", { name: new RegExp(admin) });
  await expect(adminRow).toContainText("no sub");

  await page.goto("/admin");
  await expect(page.getByText("Subscribers", { exact: true })).toBeVisible();
  const before = {
    paidUsers: await stat(page, "Paid users"),
    subscribers: await stat(page, "Subscribers"),
    comped: await compedCount(page),
  };
  expect(before.subscribers).toBeGreaterThanOrEqual(1);

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
  await expect(adminRow).toContainText("pro");

  // The reason an admin typed is kept, and reachable: it hangs off the badge
  // on hover rather than adding a line to every comped row. Asserted as
  // hidden first, so a reason that leaked back into the row would fail here
  // rather than pass on the wrong element.
  const reason = page.getByText("Design partner");
  await expect(reason).toBeHidden();
  await adminRow.getByText("comped").hover();
  await expect(reason).toBeVisible();

  // Access went up and paying did not, which is the whole point of splitting
  // the two facts.
  //
  // Stated as the gap between the counters rather than each one on its own:
  // other tests in this run give themselves a paying subscription (setPlan)
  // whenever they need a paid feature, and each of those adds one to both
  // totals at a moment this test cannot predict. It leaves the gap alone,
  // and the gap is what a comp actually moves.
  await page.goto("/admin");
  await expect(page.getByText("Subscribers", { exact: true })).toBeVisible();
  expect(await compedCount(page)).toBe(before.comped + 1);
  const paidWithoutSubscription =
    (await stat(page, "Paid users")) - (await stat(page, "Subscribers"));
  expect(paidWithoutSubscription).toBe(before.paidUsers - before.subscribers + 1);

  // Revoking it takes the access away again, and leaves the subscriber alone.
  await page.goto("/admin/users");
  await adminRow.getByRole("button", { name: `Actions for` }).click();
  await page.getByRole("menuitem", { name: "Revoke comp" }).click();
  await expect(page.getByText("Comp revoked")).toBeVisible();
  await expect(adminRow).toContainText("no sub");
  await expect(subscriberRow).toContainText("paid");
});
