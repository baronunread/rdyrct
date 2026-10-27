import { expect, test } from "@playwright/test";

/**
 * /branded-link-shortener: the page for "branded link shortener" searches.
 * It is linked from every footer, states the plans from PLAN_LIMITS and
 * PLAN_PRICES, and ends on one sign-up.
 */

test("the branded link page says what a domain costs and leads to sign-up", async ({ page }) => {
  await page.goto("/branded-link-shortener");
  await expect(
    page.getByRole("contentinfo").getByRole("link", { name: "Branded links" }),
  ).toHaveAttribute("href", "/branded-link-shortener");
  await expect(
    page.getByRole("heading", { level: 1, name: "Branded link shortener" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Branded link shortener/);

  const plans = page.getByRole("table");
  await expect(plans.getByRole("row", { name: /Hobby/ })).toContainText("$4 a month");
  await expect(plans.getByRole("row", { name: /Pro/ })).toContainText("5 custom domains");

  await page.getByRole("link", { name: "Sign up free" }).click();
  await expect(page).toHaveURL(/\/signup/);
});
