import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { compUser, rawSql } from "./db";

const password = "test-password-123";

/**
 * The billing page decides one thing: which single control to offer for the
 * account's plan. Free gets two upgrade buttons, a paid plan with a billing
 * account gets the portal, and a comped plan gets neither, because the portal
 * cannot open for someone Polar has never heard of (#85).
 *
 * That last branch is the one worth pinning: it is the only place the comp is
 * explained to the person holding it, and getting it wrong shows them a button
 * that errors.
 */
test("billing offers upgrades on free, and explains a comp instead of a portal", async ({
  page,
}) => {
  const email = `billing-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  await page.goto("/billing");
  await expect(page.getByRole("button", { name: /Upgrade to Hobby/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Upgrade to Pro/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "View invoices" })).toHaveCount(0);

  // The same account, now holding Pro as a gift rather than a subscription.
  await compUser(page, email, "pro");
  await page.goto("/billing");

  await expect(page.getByText("You have Pro for free, with our thanks.")).toBeVisible();
  await expect(page.getByRole("button", { name: "View invoices" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Upgrade to/ })).toHaveCount(0);
});

/**
 * A subscriber's page (the redesign): price and renewal on the plan line,
 * Change plan and Cancel beside it, the usage meters inside the same card,
 * then the card and the invoices, each a way into Polar's portal. Nothing
 * here is clicked through to Polar; the portal is Polar's to test.
 */
test("a subscriber sees price, renewal, usage in the plan card, card and invoices", async ({
  page,
}) => {
  const email = `billing-sub-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  const renews = Date.UTC(2031, 10, 14, 12);
  await rawSql(
    page,
    `UPDATE user SET plan = 'pro', subscription_plan = 'pro', subscription_status = 'active',
       polar_customer_id = ?, polar_subscription_id = ?, polar_subscription_interval = 'month',
       polar_subscription_current_period_end = ?, polar_subscription_cancel_at_period_end = 0
     WHERE email = ?`,
    [`cus_e2e_${Date.now()}`, `sub_e2e_${Date.now()}`, renews, email],
  );

  await page.goto("/billing");
  await expect(page.getByText("$9 a month, renews Nov 14")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByText("Organizations", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View invoices" })).toBeVisible();

  await page.getByRole("button", { name: "Change plan" }).click();
  const dialog = page.getByRole("dialog", { name: "Change plan" });
  await expect(dialog.getByRole("group", { name: "Billing cycle" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Switch to Hobby" })).toBeVisible();
  await expect(dialog.getByText(/Switching down deletes nothing/)).toBeVisible();
});
