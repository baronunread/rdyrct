import { expect, test } from "@playwright/test";

test("builds a tagged link, tidies its case, and copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/utm-builder");
  await expect(page.getByRole("heading", { level: 1, name: "UTM builder" })).toBeVisible();

  const output = page.getByRole("status", { name: "Tagged link" });
  await expect(output).toHaveText("Paste a link to start.");

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Paste a link first")).toBeVisible();

  await page
    .getByPlaceholder("https://example.com/spring-sale")
    .fill("example.com/spring?ref=mail&utm_source=Newsletter");
  await expect(page.getByPlaceholder("https://example.com/spring-sale")).toHaveValue(
    "https://example.com/spring?ref=mail",
  );
  await expect(page.getByPlaceholder("newsletter")).toHaveValue("Newsletter");

  await page.getByRole("button", { name: "LinkedIn" }).click();
  await expect(page.getByPlaceholder("newsletter")).toHaveValue("linkedin");
  await expect(page.getByPlaceholder("email")).toHaveValue("social");
  await expect(page.getByRole("button", { name: "LinkedIn" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByPlaceholder("newsletter").fill("Newsletter");
  await expect(page.getByRole("button", { name: "LinkedIn" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.getByPlaceholder("email").fill("Email Blast");
  await page.getByPlaceholder("spring-sale", { exact: true }).fill("spring-sale");
  await expect(output).toHaveText(
    "https://example.com/spring?ref=mail&utm_source=Newsletter&utm_medium=Email+Blast&utm_campaign=spring-sale",
  );

  const fix = page.getByRole("button", { name: "Use lowercase and hyphens" });
  await expect(fix).toBeVisible();
  await fix.click();
  await expect(fix).toHaveCount(0);
  const tagged =
    "https://example.com/spring?ref=mail&utm_source=newsletter&utm_medium=email-blast&utm_campaign=spring-sale";
  await expect(output).toHaveText(tagged);

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText(/^Copied example\.com\/spring/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(tagged);
});

test("shortens the tagged link, and the short link carries the tags", async ({ page }) => {
  await page.goto("/utm-builder");
  const destination = `https://example.com/utm-${Date.now()}`;
  await page.getByPlaceholder("https://example.com/spring-sale").fill(destination);
  await page.getByPlaceholder("newsletter").fill("linkedin");
  await page.getByPlaceholder("email").fill("social");

  await page.getByRole("button", { name: "Shorten it" }).click();
  const short = page.getByRole("link", { name: "Your short link" });
  await expect(short).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /Keep this link/ })).toHaveAttribute(
    "href",
    "/signup",
  );

  // The shared host (rdyr.cc) does not resolve in this suite, so the slug goes to the app host.
  const slug = (await short.getAttribute("href"))!.split("/").pop()!;
  const res = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toBe(`${destination}?utm_source=linkedin&utm_medium=social`);

  await page.reload();
  await page.getByPlaceholder("https://example.com/spring-sale").fill(destination);
  await expect(page.getByRole("link", { name: "Sign up to shorten it" })).toHaveAttribute(
    "href",
    "/signup",
  );
});

test("builds many links at once, copies them all and downloads a CSV", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/utm-builder");
  await page.getByRole("button", { name: "Many links" }).click();

  const urls = page.getByLabel("Website URLs");
  await page.getByRole("button", { name: "Copy all" }).click();
  await expect(page.getByText("Paste a link first")).toBeVisible();
  await expect(urls).toBeFocused();

  await page.getByRole("button", { name: "One link" }).click();
  await page.getByRole("button", { name: "Many links" }).click();
  await expect(urls).not.toBeFocused();
  await expect(urls).not.toHaveAttribute("aria-invalid", "true");

  await urls.fill("not an address");
  await page.getByRole("button", { name: "Download CSV" }).click();
  await expect(page.getByText("Not a web address", { exact: true })).toBeVisible();

  await urls.fill("example.com/a\nnot an address\nhttps://example.com/b");
  await page.getByPlaceholder("spring-sale", { exact: true }).fill("spring-sale");
  const channels = page.getByRole("group", { name: "Channels" });
  await channels.getByRole("button", { name: "LinkedIn" }).click();
  await channels.getByRole("button", { name: "Newsletter" }).click();

  const list = page.getByRole("list", { name: "Tagged links" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByText("Line 2 is not a web address")).toBeVisible();

  await page.getByRole("button", { name: "Copy all" }).click();
  await expect(page.getByText("Copied 4 links")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split("\n")).toEqual([
    "https://example.com/a?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale",
    "https://example.com/a?utm_source=linkedin&utm_medium=social&utm_campaign=spring-sale",
    "https://example.com/b?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale",
    "https://example.com/b?utm_source=linkedin&utm_medium=social&utm_campaign=spring-sale",
  ]);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^utm-links-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await (await download.createReadStream()).toArray();
  const rows = Buffer.concat(csv).toString("utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  expect(rows).toHaveLength(5);
  expect(rows[1]).toBe(
    "https://example.com/a,newsletter,email,spring-sale,,,https://example.com/a?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale",
  );
});

test("saves tags as a template that survives a reload", async ({ page }) => {
  await page.goto("/utm-builder");
  const source = page.getByPlaceholder("newsletter");

  // A template with no source would split from every link tagged with one.
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByText("Needed for a template")).toBeVisible();
  await expect(source).toBeFocused();

  await source.fill("newsletter");
  await page.getByPlaceholder("email").fill("email");
  await page.getByPlaceholder("spring-sale", { exact: true }).fill("weekly");
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByText("Template saved")).toBeVisible();

  await page.reload();
  const template = page.getByRole("button", { name: "newsletter / email / weekly", exact: true });
  await expect(template).toBeVisible();
  await template.click();
  await expect(source).toHaveValue("newsletter");
  await expect(page.getByPlaceholder("spring-sale", { exact: true })).toHaveValue("weekly");
  await expect(template).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Many links" }).click();
  await expect(
    page
      .getByRole("group", { name: "Channels" })
      .getByRole("button", { name: "newsletter / email" }),
  ).toHaveCount(0); // the Newsletter preset already is that pair
  await page.getByRole("button", { name: "One link" }).click();

  await page.getByRole("button", { name: "Remove template newsletter / email / weekly" }).click();
  await expect(template).toHaveCount(0);

  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByText(/Could not save the template/)).toBeVisible();
  await expect(page.getByText("Template saved")).toHaveCount(0);
});

test("explains the parameters and answers common questions", async ({ page }) => {
  await page.goto("/utm-builder");
  for (const name of [
    "What each UTM parameter is for",
    "How Google Analytics 4 reads your tags",
    "Keep one spelling per value",
    "Common UTM mistakes",
    "UTM builder questions",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await page.getByText("Are UTM parameters case sensitive?").click();
  await expect(page.getByText("Use lowercase for every value.")).toBeVisible();
  const json = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(json.join("\n")).toContain("FAQPage");
});

test("the footer leads to it", async ({ page }) => {
  await page.goto("/qr-code-generator");
  await page.getByRole("contentinfo").getByRole("link", { name: "UTM builder" }).click();
  await expect(page).toHaveURL(/\/utm-builder$/);
  await expect(page.getByRole("heading", { level: 1, name: "UTM builder" })).toBeVisible();
});
