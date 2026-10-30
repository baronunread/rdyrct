import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, queryRows, seedSubscriber } from "./db";

const password = "test-password-123";

/** The number on one /admin stat card. */
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
 * The three /admin counts a comp could wrongly move, each against the rows it
 * stands for, written here from the definitions rather than the Worker's
 * formula: somebody pays when they are on a paid plan that no comp gave them.
 *
 * Neither a fixed number nor a before/after delta holds: every other worker
 * in the run gives itself a paying subscription (setPlan) whenever it needs a
 * paid feature, at moments this test cannot predict. So the page and the rows
 * are read together, and read again until no other test wrote in between.
 */
async function expectCountsMatchRows(page: Page) {
  await expect(async () => {
    await page.goto("/admin");
    await expect(page.getByText("Subscribers", { exact: true })).toBeVisible();
    const [rows] = await queryRows<{ paying: number; subscribers: number; comped: number }>(
      page,
      `select
         (select count(*) from user where plan != 'free' and comp_plan is null) as paying,
         (select count(*) from user where subscription_plan is not null
            and subscription_status in ('active', 'trialing', 'past_due')) as subscribers,
         (select count(*) from user where comp_plan is not null) as comped`,
    );
    expect(await stat(page, "Paid users")).toBe(Number(rows.paying));
    expect(await stat(page, "Subscribers")).toBe(Number(rows.subscribers));
    expect(await compedCount(page)).toBe(Number(rows.comped));
  }).toPass({ timeout: 30_000 });
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
  // The whole platform's user list: slower to come back than one org's page.
  await expect(subscriberRow).toContainText("pro", { timeout: 10_000 });

  // The admin's own row: free, and not comped.
  const adminRow = page.getByRole("row", { name: new RegExp(admin) });
  await expect(adminRow).toContainText("free");
  await expect(adminRow).not.toContainText("comped");

  await expectCountsMatchRows(page);

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

  // A comp grants access but is not a paying customer: it is in the comped
  // count, and in neither the paid-users total nor the subscriber total.
  await expectCountsMatchRows(page);

  // Revoking it takes the access away again, and leaves the subscriber alone.
  await page.goto("/admin/users");
  await adminRow.getByRole("button", { name: `Actions for` }).click();
  await page.getByRole("menuitem", { name: "Revoke comp" }).click();
  await expect(page.getByText("Comp revoked")).toBeVisible();
  await expect(adminRow).toContainText("free");
  await expect(adminRow).not.toContainText("comped");
  await expect(subscriberRow).toContainText("pro");
});
