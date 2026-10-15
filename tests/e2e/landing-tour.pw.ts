import { expect, test, type Page } from "@playwright/test";

/**
 * The landing page's product tour and the link bar that follows a visitor
 * who made an anonymous link. Both are browser-only behaviour: the tour
 * switches screens and lazy-loads the real chart components, and the bar
 * reads the link the hero stored and counts down its real expiry.
 */

test("the product tour switches between the dashboard, links and analytics", async ({ page }) => {
  await page.goto("/");
  const tour = page.locator("#analytics");
  await tour.scrollIntoViewIfNeeded();

  await expect(tour.getByText("See your organization's link activity at a glance")).toBeVisible();

  await page.getByRole("tab", { name: /share it/i }).click();
  await expect(tour.getByText("Short links, UTM tagging and QR codes")).toBeVisible();
  await expect(tour.getByText("rdyrct.com/links")).toBeVisible();

  await page.getByRole("tab", { name: /see what worked/i }).click();
  await expect(tour.getByLabel("Clicks per day")).toBeVisible();
  await expect(page.getByRole("tab", { name: /see what worked/i })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

// The selected tab's progress bar is the tour's only clock, so the step has
// to move on by itself when the bar fills, and each tab has to name its panel.
test("the tour moves on by itself while it is on screen", async ({ page }) => {
  await page.goto("/");
  await page.locator("#analytics").scrollIntoViewIfNeeded();
  const share = page.getByRole("tab", { name: /share it/i });
  await expect(share).toHaveAttribute("aria-selected", "true", { timeout: 12_000 });
  await expect(page.getByRole("tabpanel", { name: /share it/i })).toBeVisible();
});

// The three tabs share one row, at equal widths, on a phone: a label wrapping
// to a second line made the third tab taller than the others.
test("the tour tabs stay on one row at equal widths on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Product tour" }).getByRole("tab");
  await expect(tabs).toHaveCount(3);
  const boxes = await tabs.evaluateAll((els) =>
    els.map((el) => {
      const { height, width } = el.getBoundingClientRect();
      // The label never wraps (whitespace-nowrap), so a label too long for
      // its tab shows up as overflow, not as a taller tab. Two pixels of
      // slack: at 320px the longest label is a pixel wider than its tab.
      const label = el.firstElementChild;
      const clipped = !label || label.scrollWidth > el.clientWidth + 2;
      return { height: Math.round(height), width: Math.round(width), clipped };
    }),
  );
  expect(boxes.every((b) => !b.clipped)).toBe(true);
  expect(new Set(boxes.map((b) => b.height)).size).toBe(1);
  expect(new Set(boxes.map((b) => b.width)).size).toBe(1);
});

async function shorten(page: Page, destination: string) {
  await page.goto("/");
  await page.getByLabel("Shorten a link, no account needed").fill(destination);
  await page.getByRole("button", { name: "Shorten it" }).click();
  const link = page.getByRole("link", { name: "Your short link" }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  return (await link.getAttribute("href"))!.trim();
}

test("a visitor who made a link sees it follow them down the page", async ({ page }) => {
  const shortUrl = await shorten(page, `https://example.com/bar-${Date.now()}`);
  const bar = page.getByRole("region", { name: "Your short link" });

  // Not while the hero card that already shows the link is on screen.
  await expect(bar).toHaveCount(0);

  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(shortUrl.replace(/^https?:\/\//, ""));
  await expect(bar.getByRole("link", { name: "Keep it, free" })).toHaveAttribute(
    "href",
    /\/signup/,
  );

  await bar.getByRole("button", { name: "Hide" }).click();
  await expect(bar).toHaveCount(0);
});

test("a visitor with no link never sees the bar", async ({ page }) => {
  await page.goto("/");
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await expect(page.getByRole("region", { name: "Your short link" })).toHaveCount(0);
});
