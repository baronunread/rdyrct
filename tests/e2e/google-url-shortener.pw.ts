import { expect, test } from "@playwright/test";

/**
 * /google-url-shortener: for people whose goo.gl links stopped. It gives
 * Google's dates with their sources, the steps to move, and one sign-up.
 */
test("the goo.gl page says what happened, cites Google, and leads to sign-up", async ({ page }) => {
  await page.goto("/google-url-shortener");
  await expect(
    page.getByRole("heading", { level: 1, name: /Google URL shortener \(goo\.gl\)/ }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Google URL shortener/);
  await expect(page.getByText("August 25, 2025", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /updating our plans for goo\.gl links/ }),
  ).toHaveAttribute("href", /blog\.google/);
  await expect(
    page.locator("footer").getByRole("link", { name: "goo.gl replacement" }),
  ).toHaveAttribute("href", "/google-url-shortener");

  await page.getByRole("link", { name: "Sign up free" }).click();
  await expect(page).toHaveURL(/\/signup/);
});
