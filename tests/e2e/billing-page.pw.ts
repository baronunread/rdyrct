import { expect, test, type Page } from "@playwright/test";
import type { BillingDetails } from "../../src/shared/types";
import { signUpAndVerify } from "./resend";
import { compUser, rawSql } from "./db";

const password = "test-password-123";

// #85: the portal cannot open for someone Polar has never heard of, so a comped plan
// gets no portal button, only the explanation.
test("billing offers upgrades on free, and explains a comp instead of a portal", async ({
  page,
}) => {
  const email = `billing-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  await page.goto("/billing");
  await expect(page.getByRole("button", { name: /Upgrade to Hobby/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Upgrade to Pro/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "View invoices" })).toHaveCount(0);
  await expect(page.getByText("Each plan covers one organization.")).toBeVisible();

  await compUser(page, email, "pro");
  await page.goto("/billing");

  await expect(page.getByText("You have Pro for free, with our thanks.")).toBeVisible();
  await expect(page.getByRole("button", { name: "View invoices" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Upgrade to/ })).toHaveCount(0);
});

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
  await expect(page.getByText("Covers one organization.")).toBeVisible();
  await expect(page.getByText("Links", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Organizations", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View invoices" })).toBeVisible();

  await page.getByRole("button", { name: "Change plan" }).click();
  const dialog = page.getByRole("dialog", { name: "Change plan" });
  await expect(dialog.getByRole("group", { name: "Billing cycle" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Switch to Hobby" })).toBeVisible();
  await expect(dialog.getByText(/Switching down deletes nothing/)).toBeVisible();
});

// The e2e worker has no Polar customer to read, so the Worker's answer shape is served here.
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
