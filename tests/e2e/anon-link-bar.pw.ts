import { expect, test, type Page } from "@playwright/test";

/**
 * The link bar that follows a visitor who made an anonymous link down the
 * landing page. Browser-only behaviour: it reads the link the hero stored and
 * counts down its real expiry.
 */

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
