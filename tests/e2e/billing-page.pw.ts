import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { compUser } from "./db";

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
  await expect(page.getByRole("button", { name: "Manage subscription" })).toHaveCount(0);

  // The same account, now holding Pro as a gift rather than a subscription.
  await compUser(page, email, "pro");
  await page.goto("/billing");

  await expect(page.getByText("You have Pro for free, with our thanks.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage subscription" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Upgrade to/ })).toHaveCount(0);
});
