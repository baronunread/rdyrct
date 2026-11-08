import { expect, test } from "@playwright/test";

// Under the hero, the app itself: three screenshots behind tabs, in the
// visitor's theme. The WebGPU background and edge light are decoration that
// only mounts where WebGPU exists, so nothing here depends on them.

test("the showcase switches views and shows only the current theme's screenshot", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/");
  const showcase = page.getByRole("region", { name: "The rdyrct app" });
  await showcase.scrollIntoViewIfNeeded();

  const tabs = showcase.getByRole("tab");
  await expect(tabs).toHaveText(["Dashboard", "Analytics", "Links"]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");

  await showcase.getByRole("tab", { name: "Analytics" }).click();
  await expect(showcase.getByRole("tab", { name: "Analytics" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(showcase).toContainText("See where every click came from");
  // Picked by hand, so it stays: no advancing past the visitor's choice.
  await page.waitForTimeout(7500);
  await expect(showcase.getByRole("tab", { name: "Analytics" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Dark theme: the dark screenshot shows and loads, the light one stays
  // hidden and is never fetched.
  const panel = showcase.getByRole("tabpanel");
  const dark = panel.locator('img[src="/showcase/analytics-dark.webp"]');
  await expect(dark).toBeVisible();
  await expect
    .poll(() => dark.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(panel.locator('img[src="/showcase/analytics-light.webp"]')).toBeHidden();
});

test("the views advance on their own until the visitor picks one", async ({ page }) => {
  await page.goto("/");
  const showcase = page.getByRole("region", { name: "The rdyrct app" });
  await expect(showcase.getByRole("tab", { name: "Dashboard" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(showcase.getByRole("tab", { name: "Analytics" })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 10_000 },
  );
});
