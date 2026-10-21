import { expect, test } from "@playwright/test";

// Public pages run wide, as the best pages in this category do: the frame,
// the closing band and the footer share one column, much wider than a
// reading measure, without ever scrolling the page sideways.

test("the landing runs wide, and its closing band and footer share its edges", async ({ page }) => {
  await page.setViewportSize({ width: 1650, height: 940 });
  await page.goto("/");
  const main = await page.locator("main").boundingBox();
  const cta = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Your next link, one hop away." }) });
  await cta.scrollIntoViewIfNeeded();
  const band = await cta.boundingBox();
  const footer = await page.locator("footer").boundingBox();

  expect(main!.width).toBeGreaterThan(1200);
  expect(band!.x).toBeCloseTo(main!.x, 0);
  expect(band!.width).toBeCloseTo(main!.width, 0);
  expect(footer!.width).toBeCloseTo(main!.width, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1650);
});

test("long text keeps a reading measure in the wide column", async ({ page }) => {
  await page.setViewportSize({ width: 1650, height: 940 });
  await page.goto("/docs");
  const paragraph = page.locator("#api p").first();
  expect((await paragraph.boundingBox())!.width).toBeLessThanOrEqual(768);
});

test("on a phone nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
