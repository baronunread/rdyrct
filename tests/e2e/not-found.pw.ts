import { expect, test } from "@playwright/test";

// The app's 404: one heading, said plainly, and a way home. The same view
// is prerendered for rdyr.cc and custom domains (scripts/prerender-404.tsx).

test("an unknown page says nothing lives there and leads home", async ({ page }) => {
  await page.goto("/there/is/nothing/here");
  await expect(
    page.getByRole("heading", { level: 1, name: "Nothing lives at this link." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go home" }).click();
  await expect(page).toHaveURL(/\/$/);
});
