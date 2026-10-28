import { expect, test, type Page } from "@playwright/test";
import type { BillingDetails } from "../../src/shared/types";
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

/** Signs up and gives the account a monthly Pro subscription renewing on
 * 14 November, the way the Polar webhook leaves the row. */
async function subscriber(page: Page, prefix: string): Promise<void> {
  const email = `${prefix}-${Date.now()}@gmail.com`;
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
}

/**
 * A subscriber's page (the redesign): price and renewal on the plan line,
 * Change plan and Cancel beside it, the usage meters inside the same card,
 * then the card and the invoices. Polar did not answer here (the e2e worker
 * has no customer it knows), so both are the portal buttons alone. Nothing
 * here is clicked through to Polar; the portal is Polar's to test.
 */
test("a subscriber sees price, renewal, usage in the plan card, card and invoices", async ({
  page,
}) => {
  await subscriber(page, "billing-sub");
  await page.route("**/api/billing/details", (route) =>
    route.fulfill({
      status: 502,
      json: { message: "Could not load the card and invoices from Polar" },
    }),
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

/**
 * With Polar answering, the card and the invoices are listed in place: the
 * card as words, each invoice with its date, plan, amount, status and a
 * download link, and the portal buttons still there to change anything.
 * The e2e worker has no Polar customer to read, so the answer is the
 * Worker's shape, served here.
 */
test("a subscriber sees their card and invoices from Polar", async ({ page }) => {
  await subscriber(page, "billing-details");
  const details: BillingDetails = {
    card: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2027 },
    invoices: [
      {
        id: "ord_e2e_2",
        date: Date.UTC(2026, 9, 14, 12),
        plan: "pro",
        amountCents: 900,
        currency: "usd",
        status: "paid",
        pdfUrl: "/api/billing/invoices/ord_e2e_2",
      },
      {
        id: "ord_e2e_1",
        date: Date.UTC(2026, 8, 14, 12),
        plan: "pro",
        amountCents: 900,
        currency: "usd",
        status: "refunded",
        pdfUrl: "/api/billing/invoices/ord_e2e_1",
      },
    ],
  };
  await page.route("**/api/billing/details", (route) => route.fulfill({ json: details }));

  await page.goto("/billing");

  await expect(page.getByText("Ending 4242, expires 08/27")).toBeVisible();
  await expect(page.getByText("Visa", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible();

  const download = page.getByRole("link", { name: "Download the invoice of Oct 14, 2026" });
  await expect(download).toHaveAttribute("href", "/api/billing/invoices/ord_e2e_2");
  await expect(page.getByText("$9.00").first()).toBeVisible();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByText("Refunded", { exact: true })).toBeVisible();
  await expect(page.getByText("Older invoices and receipts")).toBeVisible();
  await expect(page.getByRole("button", { name: "View invoices" })).toBeVisible();
});
