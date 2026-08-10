import { expect, test } from "@playwright/test";

/**
 * The standalone QR generator (Direction D of #96).
 *
 * It exists to answer a search with a working tool, so the things worth
 * asserting are that it works without an account and that it does not
 * quietly need one.
 */

test("generates a QR code with no account and no network call", async ({ page }) => {
  // Nothing typed here should leave the browser: the code is drawn locally,
  // which the page states outright. Anything posted while merely typing
  // would make that claim false.
  const posted: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posted.push(r.url());
  });

  await page.goto("/qr-code-generator");
  await expect(page.getByRole("heading", { name: "Free QR code generator" })).toBeVisible();

  await page.getByLabel("Link or text").fill("https://example.com/printed-poster");

  // A canvas or svg appears, and with it the download controls.
  await expect(page.getByRole("button", { name: "PNG" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "SVG" })).toBeVisible();

  expect(posted.filter((url) => !url.includes("/api/cap/"))).toEqual([]);
});

test("downloads a printable PNG", async ({ page }) => {
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/download-me");

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "PNG" }).click(),
  ]).then(([event]) => event);

  expect(await download.path()).toBeTruthy();
});

test("turning the code into a trackable link needs no account either", async ({ page }) => {
  await page.goto("/qr-code-generator");
  await page.getByLabel("Link or text").fill("https://example.com/trackable");

  await page.getByRole("button", { name: "Count the scans" }).click();
  await expect(page.getByText(/counts scans/i)).toBeVisible({ timeout: 25_000 });

  // The code now encodes the short link, not the original address, which is
  // the whole point: a scan has to pass through us to be counted.
  await expect(page.getByRole("button", { name: "Keep this code" })).toBeVisible();
});

test("the page is reachable from the footer of the landing page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "QR generator" }).click();
  await expect(page.getByRole("heading", { name: "Free QR code generator" })).toBeVisible();
});
