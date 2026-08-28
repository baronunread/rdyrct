import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

test("link stats keep their layout while loading (#174)", async ({ page }) => {
  await signUpAndVerify(page, `link-skeleton-${Date.now()}@gmail.com`, password);

  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await destination.fill("https://example.com/loading");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
  await page.keyboard.press("Escape");

  let releaseStats!: () => void;
  const statsHeld = new Promise<void>((resolve) => {
    releaseStats = resolve;
  });
  await page.route("**/api/orgs/*/links/stats/**", async (route) => {
    await statsHeld;
    await route.continue();
  });

  await page.goto("/links");
  const row = page.locator("tbody tr").first();
  await row.getByLabel(/Actions for/).click();
  await page.getByRole("menuitem", { name: "View analytics" }).click();
  await expect(page.locator(".animate-pulse").first()).toBeVisible();

  releaseStats();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
});

test("the country map is not a keyboard focus target (#175)", async ({ page }) => {
  await signUpAndVerify(page, `map-focus-${Date.now()}@gmail.com`, password);

  await page.route("**/api/orgs/*/stats**", async (route) => {
    const response = await route.fetch();
    // SAFETY: this route is the stats endpoint, whose response always has a countries array.
    const stats = (await response.json()) as { countries: { key: string; clicks: number }[] };
    stats.countries = [{ key: "US", clicks: 1 }];
    await route.fulfill({ response, json: stats });
  });

  await page.goto("/analytics");
  const map = page.getByLabel("Clicks by country");
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("tabindex", "-1");
});
