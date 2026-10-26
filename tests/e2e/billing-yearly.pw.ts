import { expect, test } from "@playwright/test";
import { setPlan } from "./db";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

/**
 * The billing page's monthly/yearly switch decides two things: what the
 * upgrade button says, and which `interval` the checkout request carries.
 * Yearly is a separate Polar product, so getting the interval onto the
 * request is what makes a yearly subscription possible at all.
 */
test("the yearly toggle drives the checkout interval and the button price", async ({ page }) => {
  const email = `billing-yearly-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  // Keep the redirect in-app: the real Polar client is never exercised in e2e.
  let checkoutBody: { plan?: string; interval?: string } | null = null;
  await page.route("**/api/billing/checkout", async (route) => {
    checkoutBody = route.request().postDataJSON();
    await route.fulfill({ json: { url: "/billing?checkout_id=test" } });
  });

  await page.goto("/billing");

  const proButton = page.getByRole("button", { name: /Upgrade to Pro/ });
  await expect(proButton).toContainText("$9/mo");

  await page.getByRole("button", { name: /^Yearly/ }).click();
  await expect(proButton).toContainText("$8.10/mo");

  await proButton.click();
  await expect.poll(() => checkoutBody).toEqual({ plan: "pro", interval: "year" });
});

/** Somebody on a paid plan has to be able to tell which cycle they are on,
 * and where to change it: the badge says it, the note under the button says
 * where. */
test("a subscriber sees their billing cycle and where to change it", async ({ page }) => {
  const email = `billing-cycle-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro", { interval: "year" });

  await page.goto("/billing");

  await expect(page.getByText("Pro · Yearly")).toBeVisible();
  await expect(page.getByText("Switch between monthly and yearly")).toBeVisible();
});
