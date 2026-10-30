import { expect, test, type Page } from "@playwright/test";

/**
 * /wifi-qr-code, /vcard-qr-code and /whatsapp-qr-code: the main generator's
 * card with fields for one job. Each must draw a code holding the text a
 * phone expects, and offer it for download, without an account.
 */

async function expectCode(page: Page, holds: RegExp) {
  const code = page.getByRole("img", { name: /^QR code for/ });
  await expect(code.locator("svg")).toBeVisible({ timeout: 10_000 });
  await expect(code).toHaveAttribute("aria-label", holds);
  await expect(page.getByRole("button", { name: /PNG/ })).toBeEnabled();
}

test("the WiFi page draws a code that joins the network", async ({ page }) => {
  await page.goto("/wifi-qr-code");
  await expect(
    page.getByRole("heading", { level: 1, name: "WiFi QR code generator" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /PNG/ })).toBeDisabled();

  await page.getByLabel("Network name").fill("Cafe;guests");
  await page.getByLabel("Password").fill("hunter22");
  await expectCode(page, /^QR code for WIFI:T:WPA;S:Cafe\\;guests;P:hunter22;;$/);

  await page.getByRole("button", { name: "Security" }).click();
  await page.getByRole("menuitem", { name: "None (open network)" }).click();
  await expectCode(page, /^QR code for WIFI:T:nopass;S:Cafe\\;guests;;$/);
});

test("the vCard page draws a contact card", async ({ page }) => {
  await page.goto("/vcard-qr-code");
  await expect(
    page.getByRole("heading", { level: 1, name: "vCard QR code generator for business cards" }),
  ).toBeVisible();

  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await expectCode(page, /BEGIN:VCARD[\s\S]*FN:Ada Lovelace[\s\S]*EMAIL:ada@example\.com/);
});

test("the WhatsApp page draws a wa.me link and leads to the others", async ({ page }) => {
  await page.goto("/whatsapp-qr-code");
  await page.getByLabel("Phone number, with country code").fill("+1 555 010 9999");
  await page.getByLabel("Message (optional)").fill("Hi there");
  await expectCode(page, /^QR code for https:\/\/wa\.me\/15550109999\?text=Hi%20there$/);

  await page
    .getByRole("navigation", { name: "Other QR codes" })
    .getByRole("link", { name: "WiFi QR code" })
    .click();
  await expect(page).toHaveURL(/\/wifi-qr-code$/);
});

test("the main generator links to each QR type", async ({ page }) => {
  await page.goto("/qr-code-generator");
  const types = page.getByRole("navigation", { name: "QR codes for one job" });
  await expect(
    types.getByRole("link", { name: "vCard QR code for business cards" }),
  ).toHaveAttribute("href", "/vcard-qr-code");
});
