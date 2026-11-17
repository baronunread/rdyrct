import { expect, test } from "@playwright/test";
import { setPlan } from "./db";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

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
  const proCard = page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) })
    .filter({ has: proButton })
    .last();
  await expect(proCard).toContainText("$9 a month");

  await page.getByRole("button", { name: /^Yearly/ }).click();
  await expect(proCard).toContainText("$8.10 a month, billed yearly");

  await proButton.click();
  await expect.poll(() => checkoutBody).toEqual({ plan: "pro", interval: "year" });
});

test("a subscriber sees their billing cycle and where to change it", async ({ page }) => {
  const email = `billing-cycle-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro", { interval: "year" });

  await page.goto("/billing");

  await expect(page.getByText("$8.10 a month, billed yearly")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change plan" })).toBeVisible();
});

test("a monthly subscriber can switch the same plan to yearly", async ({ page }) => {
  const email = `billing-to-yearly-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro", { interval: "month" });

  let portalOpened = false;
  await page.route("**/api/billing/portal", async (route) => {
    portalOpened = true;
    await route.fulfill({ json: { url: "/billing" } });
  });

  await page.goto("/billing");
  await page.getByRole("button", { name: "Change plan" }).click();
  const dialog = page.getByRole("dialog", { name: "Change plan" });
  await expect(dialog.getByRole("button", { name: "Current plan" })).toBeVisible();

  await dialog.getByRole("button", { name: /^Yearly/ }).click();
  await expect(dialog.getByRole("button", { name: "Current plan" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Switch to yearly" }).click();
  await expect.poll(() => portalOpened).toBe(true);
});
