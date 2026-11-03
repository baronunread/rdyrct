import { expect, test } from "@playwright/test";

/**
 * /qr-code-monkey-alternative: QR Code Monkey, QR.io and QR Code Generator
 * Pro against rdyrct on one page. It names all three in the table, says where
 * they win, and offers both the free generator and an account.
 */
test("the QR comparison names all three tools and leads to the generator", async ({ page }) => {
  await page.goto("/qr-code-monkey-alternative");
  await expect(
    page.getByRole("heading", { level: 1, name: "QR Code Monkey alternative" }),
  ).toBeVisible();
  for (const tool of ["QR Code Monkey", "QR.io", "QR Code Generator Pro"]) {
    await expect(page.getByRole("columnheader", { name: tool, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("row", { name: /^Price/ })).toContainText("$39.99 a month");
  await expect(
    page.getByRole("heading", { name: "Where the others are the better choice" }),
  ).toBeVisible();
  await expect(
    page.locator("footer").getByRole("link", { name: "QR Code Monkey alternative" }),
  ).toHaveAttribute("href", "/qr-code-monkey-alternative");

  await page.getByRole("link", { name: "Make a QR code now" }).click();
  await expect(page).toHaveURL(/\/qr-code-generator$/);
});
