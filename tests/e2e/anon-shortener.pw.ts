import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createOrg } from "./orgs";
import { queryRows } from "./db";

/**
 * The anonymous shortener in the hero, and the claim that follows it
 * (Direction A of #96).
 *
 * This is the one place in the app where an unauthenticated request writes to
 * the database, so what it does and does not allow is worth asserting in a
 * real browser: the Cap proof-of-work runs there, not in a worker test.
 */

const password = "test-password-123";

/** Paste a URL into the hero form and wait for the short link to come back. */
async function shorten(page: import("@playwright/test").Page, destination: string) {
  await page.goto("/");
  const field = page.getByLabel("Try it without an account");
  await expect(field).toBeVisible();
  await field.fill(destination);
  await page.getByRole("button", { name: "Shorten it" }).click();

  await expect(page.getByText("Your link is live")).toBeVisible({ timeout: 20_000 });
  // By its own label, not by text: the page header links the word
  // "rdyrct" too, and that match is the one a loose selector finds first.
  const shortUrl = await page.getByRole("link", { name: "Your short link" }).getAttribute("href");
  return shortUrl!.trim();
}

test("a visitor with no account gets a working short link", async ({ page }) => {
  const destination = `https://example.com/anon-${Date.now()}`;
  const shortUrl = await shorten(page, destination);
  // The host comes from APP_URL, which differs between local dev and this
  // suite, so assert the shape rather than a hard-coded hostname.
  expect(shortUrl).toMatch(/^https?:\/\/[^/]+\/[A-Za-z0-9_-]+$/);

  // It actually redirects, which is the only claim on the page that matters.
  const slug = shortUrl.split("/").pop()!;
  const response = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe(destination);
});

test("an anonymous link records no clicks, which is what signing up buys", async ({ page }) => {
  const destination = `https://example.com/anon-clicks-${Date.now()}`;
  const shortUrl = await shorten(page, destination);
  const slug = shortUrl.split("/").pop()!;

  await page.request.get(`/${slug}`, { maxRedirects: 0 });
  await page.waitForTimeout(1000);

  // No org and no links row means nothing a click could belong to. The
  // absence is the product boundary, not an oversight.
  const clicks = await queryRows<{ n: number }>(page, "select count(*) as n from clicks");
  expect(Number(clicks[0].n)).toBe(0);
});

test("signing up keeps the link that was made before the account (#65)", async ({ page }) => {
  const destination = `https://example.com/claimed-${Date.now()}`;
  const shortUrl = await shorten(page, destination);
  const slug = shortUrl.split("/").pop()!;

  await signUpAndVerify(page, `anon-${Date.now()}@gmail.com`, password);
  await createOrg(page, "Claimed Org");

  // The new account's first dashboard is not empty: the link they made
  // before signing up is already in it, on the same slug.
  await page.goto("/links");
  await expect(page.getByText(slug, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // And it is a real link now: owned, permanent, and no longer an anonymous
  // row waiting to be swept.
  const links = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from links where slug = ?",
    [slug],
  );
  expect(Number(links[0].n)).toBe(1);

  const anon = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from anon_links where slug = ?",
    [slug],
  );
  expect(Number(anon[0].n)).toBe(0);
});

test("a destination that is not a web address is refused, in a toast", async ({ page }) => {
  // "not-a-web-address" has no dot, so it survives the scheme-less
  // normalisation the signed-in quick-create also does and then fails the
  // hostname check, which is the boundary worth showing here.
  await page.goto("/");
  const field = page.getByLabel("Try it without an account");
  await field.fill("not-a-web-address");
  await page.getByRole("button", { name: "Shorten it" }).click();

  await expect(page.getByText(/does not look like a web address/i)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Your link is live")).toBeHidden();
});

test("the shortener refuses a request with no proof of work", async ({ page }) => {
  // Straight to the endpoint, bypassing the widget. This is the request a
  // script would make, and the whole reason #98 shipped before this did.
  const response = await page.request.post("/api/shorten", {
    data: { destination: "https://example.com/scripted" },
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("human");
});
