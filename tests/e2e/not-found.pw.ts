import { expect, test } from "@playwright/test";

test("an unknown page says nothing lives there and leads home", async ({ page }) => {
  await page.goto("/there/is/nothing/here");
  await expect(
    page.getByRole("heading", { level: 1, name: "No link at this address." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go home" }).click();
  await expect(page).toHaveURL(/\/$/);
});
