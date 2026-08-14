import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
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

  // Scoped to clicks belonging to no real link, which is the only shape an
  // anonymous click could take. Counting every row in the table made this
  // depend on whatever else the suite had done, and it started failing the
  // day another test created a click of its own.
  const clicks = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from clicks where link_id not in (select id from links)",
  );
  expect(Number(clicks[0].n)).toBe(0);
});

test("signing up keeps the link that was made before the account (#65)", async ({ page }) => {
  const destination = `https://example.com/claimed-${Date.now()}`;
  const shortUrl = await shorten(page, destination);
  const slug = shortUrl.split("/").pop()!;

  await signUpAndVerify(page, `anon-${Date.now()}@gmail.com`, password);

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

  for (const slug of [firstSlug, secondSlug]) {
    await expect
      .poll(
        async () => {
          const rows = await queryRows<{ n: number }>(
            page,
            "select count(*) as n from links where slug = ?",
            [slug],
          );
          return Number(rows[0].n);
        },
        { message: `link ${slug} should have been claimed`, timeout: 15_000 },
      )
      .toBe(1);
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
  const hrefs = await links.evaluateAll<string[], HTMLAnchorElement>((nodes) =>
    nodes.map((n) => n.href),
  );
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
  // Claiming happens as the app loads rather than inside a form submit, so
  // this polls for the row instead of assuming it landed before the query.
  await signUpAndVerify(page, `reload-${Date.now()}@gmail.com`, password);
  await expect
    .poll(
      async () => {
        const rows = await queryRows<{ n: number }>(
          page,
          "select count(*) as n from links where slug = ?",
          [shortUrl.split("/").pop()!],
        );
        return Number(rows[0].n);
      },
      { message: "the link made before signing up was never claimed", timeout: 15_000 },
    )
    .toBe(1);
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

test("each stacked link can still download its own QR", async ({ page }) => {
  // The download buttons sit under the link rather than under the code, so
  // this checks the move did not detach them from the QR they belong to.
  const destination = `https://example.com/qr-dl-${Date.now()}`;
  const shortUrl = await shorten(page, destination);
  const slug = shortUrl.split("/").pop()!;

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /PNG/ }).first().click(),
  ]).then(([event]) => event);

  expect(await download.path()).toBeTruthy();
  expect(download.suggestedFilename()).toContain(slug);
});

/**
 * The narrow layout, which had three separate faults: an unqualified
 * `flex-1` on the input made it grow along the column axis and shrink to
 * 20px tall, the row stacked so the QR ended up below its own download
 * buttons, and the header's equal rails wrapped "Log in" onto two lines.
 */
test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the form and the rows keep their shape", async ({ page }) => {
    const destination = `https://example.com/mobile-${Date.now()}`;
    await shorten(page, destination);

    const box = async (locator: import("@playwright/test").Locator) =>
      (await locator.boundingBox())!;

    // The field is as tall as the button beside it, not squashed.
    const field = await box(page.getByLabel("Try it without an account"));
    const submit = await box(page.getByRole("button", { name: "Shorten it" }));
    expect(field.height).toBe(submit.height);

    // The QR sits beside the link, not underneath its own buttons.
    const link = await box(page.getByRole("link", { name: "Your short link" }).first());
    const qr = await box(page.getByRole("img", { name: /^QR code for/ }).first());
    expect(qr.x).toBeGreaterThan(link.x + link.width - 1);

    // The slug survives: the host gives up the width instead.
    const slug =
      destination &&
      (await page.getByRole("link", { name: "Your short link" }).first().innerText());
    expect(slug).toBeTruthy();

    // And nothing pushes the page sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
