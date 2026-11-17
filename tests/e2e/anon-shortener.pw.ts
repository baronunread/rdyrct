import { expect, test } from "@playwright/test";
import { signUpThroughForm } from "./resend";
import { queryRows } from "./db";

// The one place an unauthenticated request writes to the database; Turnstile runs in
// a real browser, not a worker test.

const password = "test-password-123";

async function shorten(page: import("@playwright/test").Page, destination: string) {
  await page.goto("/");
  const field = page.getByLabel("Shorten a link, no account needed");
  await expect(field).toBeVisible();
  await field.fill(destination);
  await page.getByRole("button", { name: "Shorten it" }).click();

  // By its own label: the page header links the word "rdyrct" too, and a loose
  // selector finds that first.
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

  const slug = shortUrl.split("/").pop()!;
  const response = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe(destination);

  await expect(page.getByText("then someone else can get its address")).toBeVisible();
});

test("the short link is on the shared link host, not the app's own host", async ({ page }) => {
  // .dev.vars.playwright pins SHARED_LINK_HOST to "rdyr.cc", distinct from
  // APP_HOST ("localhost:5174"): the anonymous shortener runs on the app
  // host but must hand back a link on the shorter shared host.
  const destination = `https://example.com/host-${Date.now()}`;
  const shortUrl = await shorten(page, destination);
  expect(new URL(shortUrl).host).toBe("rdyr.cc");
});

test("an anonymous link shows its click total but records no click details", async ({ page }) => {
  const destination = `https://example.com/anon-clicks-${Date.now()}`;
  const shortUrl = await shorten(page, destination);
  const slug = shortUrl.split("/").pop()!;

  await page.request.get(`/${slug}`, { maxRedirects: 0 });

  // The count lands after the redirect is sent, so it also shows the click was handled.
  await page.reload();
  await expect(page.getByText("1 click so far.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("then someone else can get its address")).toBeVisible();

  // Scoped to clicks belonging to no real link. Counting every row made this depend on
  // whatever else the suite had done.
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

  await signUpThroughForm(page, `anon-${Date.now()}@gmail.com`, password);

  await page.goto("/links");
  await expect(page.getByText(slug, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

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

test("a destination that is not a web address marks the field", async ({ page }) => {
  // "not-a-web-address" has no dot, so it survives the scheme-less
  // normalisation the signed-in quick-create also does and then fails the
  // hostname check, which is the boundary worth showing here.
  await page.goto("/");
  const field = page.getByLabel("Shorten a link, no account needed");
  await field.fill("not-a-web-address");
  await page.getByRole("button", { name: "Shorten it" }).click();

  await expect(field).toHaveAttribute("aria-invalid", "true", { timeout: 20_000 });
  await expect(page.getByText("Not a web address")).toBeVisible();
  await field.fill("example.com");
  await expect(field).not.toHaveAttribute("aria-invalid");
  await expect(page.getByRole("link", { name: "Your short link" })).toHaveCount(0);
});

test("the shortener refuses a request with no Turnstile token", async ({ page }) => {
  const response = await page.request.post("/api/shorten", {
    data: { destination: "https://example.com/scripted" },
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("human");
});

/** The result is an answer to a button somebody pressed, so it arrives
 * instead of appearing. Asserted as the animation the card carries, which is
 * the part a stylesheet edit can drop by accident. */
test("links survive a reload, so leaving the page does not lose them", async ({ page }) => {
  const destination = `https://example.com/reload-${Date.now()}`;
  const shortUrl = await shorten(page, destination);

  await page.reload();

  const restored = page.getByRole("link", { name: "Your short link" }).first();
  await expect(restored).toBeVisible({ timeout: 15_000 });
  expect(await restored.getAttribute("href")).toBe(shortUrl);
  await expect(page.getByText(`from ${destination}`)).toBeVisible();

  // And it is still claimable: the token came back with it, not just the URL.
  // Claiming happens as the app loads rather than inside a form submit, so
  // this polls for the row instead of assuming it landed before the query.
  await signUpThroughForm(page, `reload-${Date.now()}@gmail.com`, password);
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

test("one link is the ceiling without an account", async ({ page }) => {
  const destination = `https://example.com/cap-${Date.now()}`;
  await shorten(page, destination);

  // The button goes dead rather than failing on submit.
  const button = page.getByRole("button", { name: "Shorten it" });
  await expect(button).toBeDisabled();
  await expect(page.getByRole("link", { name: "Keep this link" })).toHaveCount(1);
  await expect(page.getByText(`from ${destination}`)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: "Your short link" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Shorten it" })).toBeDisabled();
});

test("the link can still download its own QR", async ({ page }) => {
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

// The QR renderer loads only once a link exists. If that load fails (a stale
// tab after a deploy), the visitor keeps the link they just made: no QR, but
// no page reload over it either.
test("a failed QR load still leaves the new link on the page", async ({ page }) => {
  let qrLoadFailed!: () => void;
  const qrAborted = new Promise<void>((resolve) => (qrLoadFailed = resolve));
  await page.route("**/src/app/components/qr.tsx*", async (route) => {
    await route.abort();
    qrLoadFailed();
  });
  await page.goto("/");
  await page.evaluate(() => (document.documentElement.dataset.stayed = "yes"));

  const field = page.getByLabel("Shorten a link, no account needed");
  await field.fill(`https://example.com/qr-fail-${Date.now()}`);
  await page.getByRole("button", { name: "Shorten it" }).click();

  await qrAborted;
  await expect(page.getByLabel("Preparing QR code")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Your short link" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /PNG/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.stayed)).toBe("yes");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a visitor can create a link and use its QR code", async ({ page }) => {
    const destination = `https://example.com/mobile-${Date.now()}`;
    await shorten(page, destination);

    await expect(page.getByRole("link", { name: "Your short link" }).first()).toBeVisible();
    await expect(page.getByRole("img", { name: /^QR code for/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /PNG/ }).first()).toBeEnabled();
  });
});
