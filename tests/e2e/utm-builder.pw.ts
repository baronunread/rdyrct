import { expect, test } from "@playwright/test";

/**
 * The free UTM builder (#281, #326): it tags a link in the browser, catches
 * values that would split in analytics, and hands the result to the
 * anonymous shortener.
 */

test("builds a tagged link, tidies its case, and copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/utm-builder");
  await expect(page.getByRole("heading", { level: 1, name: "UTM builder" })).toBeVisible();

  const output = page.getByRole("status", { name: "Tagged link" });
  await expect(output).toHaveText("Paste a link to start.");

  // Copy is never disabled: with nothing to copy it marks the field.
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Paste a link first")).toBeVisible();

  // No scheme is fine, and a pasted link that is already tagged fills the
  // fields from its own parameters.
  await page
    .getByPlaceholder("https://example.com/spring-sale")
    .fill("example.com/spring?ref=mail&utm_source=Newsletter");
  await expect(page.getByPlaceholder("https://example.com/spring-sale")).toHaveValue(
    "https://example.com/spring?ref=mail",
  );
  await expect(page.getByPlaceholder("newsletter")).toHaveValue("Newsletter");

  // A preset fills source and medium together; editing one lets it go.
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

  // Capitals and spaces report apart from their lowercase twins.
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

  // The short link sends the visitor to the tagged address.
  // On the shared host (rdyr.cc here), which this suite cannot resolve, so
  // the slug goes to the app host, as anon-shortener.pw.ts does.
  const slug = (await short.getAttribute("href"))!.split("/").pop()!;
  const res = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toBe(`${destination}?utm_source=linkedin&utm_medium=social`);

  // This browser has spent its one free link: the next one is a sign-up.
  await page.reload();
  await page.getByPlaceholder("https://example.com/spring-sale").fill(destination);
  await expect(page.getByRole("link", { name: "Sign up to shorten it" })).toHaveAttribute(
    "href",
    "/signup",
  );
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
  // The same questions are FAQPage data for a search result.
  const json = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(json.join("\n")).toContain("FAQPage");
});

test("the footer leads to it", async ({ page }) => {
  await page.goto("/qr-code-generator");
  await page.getByRole("contentinfo").getByRole("link", { name: "UTM builder" }).click();
  await expect(page).toHaveURL(/\/utm-builder$/);
  await expect(page.getByRole("heading", { level: 1, name: "UTM builder" })).toBeVisible();
});
