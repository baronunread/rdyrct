import { expect, test } from "@playwright/test";
import { visitLegalPages } from "./pages";

test("landing page keeps the main sign-up path", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page
    .getByRole("link", { name: /get started/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/signup/);
});

test("legal pages retain their baseline headings", async ({ page }) => {
  await visitLegalPages(page);
});
