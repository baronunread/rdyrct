import { expect, test } from "@playwright/test";

// A page ends wider than its column: the last call to action and the footer
// step out to the same edges, without ever scrolling the page sideways.

test("the final call to action and the footer step out of the column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const main = await page.locator("main").boundingBox();
  const cta = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Your next link, one hop away." }) });
  await cta.scrollIntoViewIfNeeded();
  const band = await cta.boundingBox();
  const footer = await page.locator("footer").boundingBox();

  expect(band!.width).toBeGreaterThan(main!.width + 100);
  expect(footer!.x).toBeCloseTo(band!.x, 0);
  expect(footer!.width).toBeCloseTo(band!.width, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test("on a phone they keep to the column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing");
  const main = await page.locator("main").boundingBox();
  const footer = await page.locator("footer").boundingBox();
  expect(footer!.width).toBeCloseTo(main!.width, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
