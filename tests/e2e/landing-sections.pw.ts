import { expect, test } from "@playwright/test";

// The landing below the hero: a section for each thing you get, the product
// shown over sample data, and details that change what it shows.

test("each detail changes what the section shows, by click and by arrow key", async ({ page }) => {
  await page.goto("/");
  const links = page.getByRole("tablist", { name: "Links that look like you." });
  await links.scrollIntoViewIfNeeded();

  const domain = links.getByRole("tab", { name: /your own domain/i });
  await expect(domain).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: /your own domain/i });
  await expect(panel.getByText("go.acme.com/podcast")).toBeVisible();

  await links.getByRole("tab", { name: /words you choose/i }).click();
  await expect(page.getByRole("tabpanel", { name: /words you choose/i })).toContainText(
    "Available on go.acme.com",
  );

  // Tabs move along the row with the arrow keys, and focus goes with them.
  await page.keyboard.press("ArrowRight");
  const tags = links.getByRole("tab", { name: /campaign tags/i });
  await expect(tags).toHaveAttribute("aria-selected", "true");
  await expect(tags).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: /campaign tags/i })).toContainText("spring-sale");
});

test("the QR section draws a real code and leads to the generator", async ({ page }) => {
  await page.goto("/");
  const qr = page.getByRole("tablist", { name: "Print once. Change it later." });
  await qr.scrollIntoViewIfNeeded();
  // The code is the app's own QR component, loaded once the section is near.
  await expect(
    page
      .getByRole("tabpanel", { name: /edit after printing/i })
      .locator("svg, canvas")
      .first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "Make a QR code" }).click();
  await expect(page).toHaveURL(/\/qr-code-generator$/);
});

// Comparisons belong on the comparison pages. The sections sell what you get
// without naming anybody else.
test("the landing sections name no competitor", async ({ page }) => {
  await page.goto("/");
  for (const name of [
    "Links that look like you.",
    "Print once. Change it later.",
    "See which post paid off.",
  ]) {
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name }) });
    await expect(section).not.toContainText(/bitly|rebrandly|dub|short\.io/i);
  }
});
