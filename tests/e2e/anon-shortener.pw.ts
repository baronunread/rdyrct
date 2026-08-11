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

  // By its own label, not by text: the page header links the word "rdyrct"
  // too, and that match is the one a loose selector finds first. The newest
  // link is first in the stack.
  const newest = page.getByRole("link", { name: "Your short link" }).first();
  await expect(newest).toBeVisible({ timeout: 20_000 });
  return (await newest.getAttribute("href"))!.trim();
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

/**
 * The footer says "keep these 2 links", so signup has to keep both. An
 * earlier version stored one claim token and overwrote it, which made that
 * copy a promise about the most recent link only.
 */
test("signing up keeps every link made before the account, not just the last", async ({ page }) => {
  const first = `https://example.com/multi-a-${Date.now()}`;
  const second = `https://example.com/multi-b-${Date.now()}`;

  const firstSlug = (await shorten(page, first)).split("/").pop()!;
  const field = page.getByLabel("Try it without an account");
  await field.fill(second);
  await page.getByRole("button", { name: "Shorten it" }).click();
  await expect(page.getByRole("link", { name: "Your short link" })).toHaveCount(2, {
    timeout: 20_000,
  });
  const secondSlug = (await page
    .getByRole("link", { name: "Your short link" })
    .first()
    .getAttribute("href"))!
    .split("/")
    .pop()!;

  await signUpAndVerify(page, `multi-${Date.now()}@gmail.com`, password);
  await createOrg(page, "Multi Org");

  for (const slug of [firstSlug, secondSlug]) {
    const rows = await queryRows<{ n: number }>(
      page,
      "select count(*) as n from links where slug = ?",
      [slug],
    );
    expect(Number(rows[0].n), `link ${slug} should have been claimed`).toBe(1);
  }
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
  await expect(page.getByRole("link", { name: "Your short link" })).toHaveCount(0);
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

/**
 * The form never swaps out, and links accumulate. This is the layout
 * decision the hero was rebuilt around: a link already on screen must never
 * change or disappear because somebody made another one.
 */
test("shortening again keeps the first link and stacks the new one on top", async ({ page }) => {
  const first = `https://example.com/first-${Date.now()}`;
  const second = `https://example.com/second-${Date.now()}`;

  const firstUrl = await shorten(page, first);

  // The form is still a form: filled, live, and in the same place. No
  // "shorten another" button to press first.
  const field = page.getByLabel("Try it without an account");
  await expect(field).toBeVisible();
  await field.fill(second);
  await page.getByRole("button", { name: "Shorten it" }).click();

  const links = page.getByRole("link", { name: "Your short link" });
  await expect(links).toHaveCount(2, { timeout: 20_000 });

  // Newest first, and the earlier one is still there and unchanged.
  const hrefs = await links.evaluateAll((nodes) => nodes.map((n) => (n as HTMLAnchorElement).href));
  expect(hrefs[1]).toBe(firstUrl);
  expect(hrefs[0]).not.toBe(firstUrl);

  // Each row says which address it came from, which is the question that
  // appears as soon as there is more than one.
  await expect(page.getByText(`from ${first}`)).toBeVisible();
  await expect(page.getByText(`from ${second}`)).toBeVisible();

  // One ask for both, counting them, rather than one per row.
  await expect(page.getByRole("link", { name: "Keep them" })).toHaveCount(1);
  await expect(page.getByText(/These 2 links work for 24 hours/)).toBeVisible();
});

test("links survive a reload, so leaving the page does not lose them", async ({ page }) => {
  const destination = `https://example.com/reload-${Date.now()}`;
  const shortUrl = await shorten(page, destination);

  await page.reload();

  // Same link, same place, still with the address it came from.
  const restored = page.getByRole("link", { name: "Your short link" }).first();
  await expect(restored).toBeVisible({ timeout: 15_000 });
  expect(await restored.getAttribute("href")).toBe(shortUrl);
  await expect(page.getByText(`from ${destination}`)).toBeVisible();

  // And it is still claimable: the token came back with it, not just the URL.
  await signUpAndVerify(page, `reload-${Date.now()}@gmail.com`, password);
  await createOrg(page, "Reload Org");
  const rows = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from links where slug = ?",
    [shortUrl.split("/").pop()!],
  );
  expect(Number(rows[0].n)).toBe(1);
});

test("three links is the ceiling without an account", async ({ page }) => {
  await page.goto("/");
  const field = page.getByLabel("Try it without an account");
  const button = page.getByRole("button", { name: "Shorten it" });

  for (let i = 0; i < 3; i++) {
    await field.fill(`https://example.com/cap-${Date.now()}-${i}`);
    await button.click();
    await expect(page.getByRole("link", { name: "Your short link" })).toHaveCount(i + 1, {
      timeout: 20_000,
    });
  }

  // The button goes dead and says why, rather than failing on submit.
  await expect(button).toBeDisabled();
  await expect(page.getByText(/most this browser can make without an account/i)).toBeVisible();

  // The ceiling holds across a reload: it is stored, not just in memory.
  await page.reload();
  await expect(page.getByRole("link", { name: "Your short link" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Shorten it" })).toBeDisabled();
});
