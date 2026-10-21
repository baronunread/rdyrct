import { expect, test } from "@playwright/test";

// The marketing header is part of the page at the top and floats once the
// page moves, the way getopen.so does it: no fill or edge until then, then a
// narrower frosted pill.

test("the header sits flush at the top and floats once the page scrolls", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const header = page.locator("header[data-marketing-header]");
  const pill = page.locator("[data-marketing-pill]");
  await expect(header).not.toHaveAttribute("data-floating");
  await expect(pill).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const flushWidth = (await pill.boundingBox())!.width;

  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  await expect(header).toHaveAttribute("data-floating", "");
  // Frosted: a fill solid enough to read the nav over, and the blur that
  // keeps the page under it from showing through as text.
  await expect
    .poll(async () => {
      const color = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
      const alpha = color.match(/\/\s*([\d.]+)\)|,\s*([\d.]+)\)$/);
      return alpha ? Number(alpha[1] ?? alpha[2]) : 1;
    })
    .toBeGreaterThanOrEqual(0.6);
  await expect(pill).toHaveCSS("backdrop-filter", /blur/);
  // And it draws in once the 700ms shrink has run.
  await expect.poll(async () => (await pill.boundingBox())!.width).toBeLessThan(flushWidth - 100);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(header).not.toHaveAttribute("data-floating");
});

test("the phone menu gives the header its fill even at the top", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const header = page.locator("header[data-marketing-header]");
  await expect(header).not.toHaveAttribute("data-floating");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(header).toHaveAttribute("data-floating", "");
});
