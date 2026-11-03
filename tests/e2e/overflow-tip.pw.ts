import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";

const password = "test-password-123";

/**
 * Truncated text shows its full value in the app's own tooltip, and only
 * when it is cut off: a destination that fits gets none.
 */
test("a cut-off destination gets a tooltip, one that fits does not", async ({ page }) => {
  await signUpAndVerify(page, `overflow-tip-${Date.now()}@gmail.com`, password);

  const long = `https://example.com/${"a-very-long-path-segment/".repeat(12)}end`;
  const short = "https://example.com/short";
  await createQuickLink(page, short);
  await page.keyboard.press("Escape");
  await createQuickLink(page, long);
  await page.keyboard.press("Escape");

  await page.goto("/links");
  const cell = (href: string) => page.locator(`a[href="${href}"]`);
  await expect(cell(long)).toBeVisible();

  await cell(long).hover();
  await expect(page.getByText(long, { exact: true })).toBeVisible();

  await page.mouse.move(0, 0);
  await cell(short).hover();
  // Give a tooltip the time it would need to open (the delay is 40ms).
  await page.waitForTimeout(400);
  await expect(page.getByText(short, { exact: true })).toHaveCount(0);
});
