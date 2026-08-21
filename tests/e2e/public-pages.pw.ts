import { expect, test } from "@playwright/test";
import { visitLegalPages } from "./pages";

test("landing page keeps the main sign-up path", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page
    .getByRole("link", { name: /get started/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/signup/);
});

// The hero used to spend its second button sending the warmest visitor on the
// page to GitHub (#96). Both hero CTAs must now keep the visitor on the site,
// and the self-host link has to still exist, further down, under pricing.
test("the hero's second CTA stays on the site and self-hosting sits under pricing", async ({
  page,
}) => {
  await page.goto("/");

  const hero = page.locator("section").first();
  await expect(hero.getByRole("link", { name: /self-host/i })).toHaveCount(0);

  await hero.getByRole("link", { name: /see the analytics/i }).click();
  await expect(page).toHaveURL(/#analytics$/);
  await expect(page.locator("#analytics")).toBeInViewport();

  // Self-hosting keeps its own section after pricing, never a column inside it.
  // The star count is baked in at build time, so it has to render as a real
  // number: a failed build-time fetch falls back rather than emitting NaN.
  const selfHost = page.locator("#self-host");
  const pill = selfHost.getByRole("link", { name: /github/i });
  await expect(pill).toHaveAttribute("href", /github\.com/);
  await expect(pill).toContainText(/\d/);
  await expect(pill).not.toContainText(/NaN|undefined/);
});

// The homepage used to carry the full four-column table, word for word the
// same one on /pricing: two copies of the same content competing for the
// same search result. It now teases three prices and sends the down-funnel
// visitor to /pricing for the table (and self-hosting, and the feature
// breakdown), same split Stripe, Linear and Vercel all draw.
test("the homepage teases three prices and points at the full comparison", async ({ page }) => {
  await page.goto("/");

  const teaser = page.locator("#pricing");
  await expect(teaser).not.toContainText(/self-hosted/i);
  await expect(teaser.getByText("Free", { exact: true })).toBeVisible();
  await expect(teaser.getByText("Hobby", { exact: true })).toBeVisible();
  await expect(teaser.getByText("Pro", { exact: true })).toBeVisible();
  await expect(teaser.locator("table")).toHaveCount(0);

  await teaser.getByRole("link", { name: /full comparison/i }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

// Reading links sit on the page's centre line; doing links (theme, auth) stay
// right. The centre must not drift when "Sign up" becomes "Dashboard", which
// is what space-between used to do.
test("header centres the reading links and keeps the auth actions right", async ({ page }) => {
  await page.goto("/");

  const header = page.locator("header");
  const nav = header.locator("nav");
  await expect(nav.getByRole("link", { name: "Pricing" })).toBeVisible();

  const navBox = (await nav.boundingBox())!;
  const headBox = (await header.boundingBox())!;
  const navCentre = navBox.x + navBox.width / 2;
  const headCentre = headBox.x + headBox.width / 2;
  expect(Math.abs(navCentre - headCentre)).toBeLessThan(2);

  // Auth actions sit to the right of the centred nav, not among it.
  const signUp = (await header.getByRole("link", { name: "Sign up" }).boundingBox())!;
  expect(signUp.x).toBeGreaterThan(navBox.x + navBox.width);

  // On a phone the three columns do not fit, so the reading links drop out
  // and the page must not scroll sideways.
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(nav).toBeHidden();
  await expect(header.getByRole("link", { name: "Sign up" })).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
});

// The homepage is a lazy chunk, so there is a moment before it arrives. What
// fills that moment used to be the cookie banner alone on an empty screen,
// which read as the whole site. The header comes from the entry chunk now and
// is on screen for all of it. Held here on the route module the dev server
// serves the page from; the assertions run while it is still in flight.
test("the header is on screen before the homepage chunk arrives", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname.includes("routes/landing"),
    async (route) => {
      await held;
      await route.continue();
    },
  );

  await page.goto("/", { waitUntil: "commit" });

  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Pricing" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign up" })).toBeVisible();
  // The page itself is still on its way, so this is the fallback, not the
  // real header arriving early.
  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();

  release();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // One header, and it never moved: the fallback uses the page's own wrapper.
  await expect(header).toHaveCount(1);
});

// The pricing table used to live only on "/", reachable by an anchor. The
// standalone page carries the real thing, deep-linkable from a search
// result. No self-host section here: that stays a homepage trust signal
// (see the test above), not something a buying page argues against itself
// with.
test("the standalone pricing page has the full table and no self-host pitch", async ({ page }) => {
  await page.goto("/pricing");

  await expect(page.getByRole("heading", { level: 1, name: /simple pricing/i })).toBeVisible();
  const headers = page.locator("#pricing thead th");
  await expect(headers).toHaveCount(4);
  await expect(headers.nth(2)).toContainText("Hobby");
  await expect(page.locator("#self-host")).toHaveCount(0);

  await page.getByRole("link", { name: "Sign up" }).first().click();
  await expect(page).toHaveURL(/\/signup/);
});

// The hero is two columns from md up: copy left, the working shortener right.
// Most products put a screenshot there because you cannot use them logged
// out; ours works with no account, so the real thing goes in that half. The
// split is also what lets the primary CTA be primary: stacked, it sat above
// the card and had to be demoted so the page did not show two primary
// actions in one column.
test("the hero puts the copy and the working shortener side by side", async ({ page }) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  const card = page.getByLabel("Try it without an account");
  await expect(heading).toBeVisible();
  await expect(card).toBeVisible();

  const h = (await heading.boundingBox())!;
  const c = (await card.boundingBox())!;
  // Side by side, not stacked: the card starts after the heading ends.
  expect(c.x).toBeGreaterThan(h.x + h.width - 1);
  // And on the same band, not below it.
  expect(c.y).toBeLessThan(h.y + h.height + 200);

  // The filled button is back, and there is only one of it in the hero.
  const hero = page.locator("section").first();
  await expect(hero.getByRole("link", { name: /get started free/i })).toBeVisible();

  // On a phone it stacks, and the card has to stay near the fold: it is the
  // one thing on this page that turns a stranger into an account.
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(card).toBeInViewport();
});

// Marketing navigation swaps the content where you stand and then rides the
// new page up to its top, which is the order resend.com uses. Two things used
// to go wrong and both are asserted here.
//
// The flash: the scroll reset landed on the page being LEFT, because the next
// page was a React.lazy chunk and Suspense hid the outgoing tree with
// `display: none` while it downloaded. The document collapsed to one viewport
// and the browser clamped the scroll to the top, so clicking Pricing from the
// FAQ snapped the landing page back to its hero and held it there. The routes
// are `lazyRouteComponent`s now, loaded by the router before it commits, so
// there is no fallback and no collapse.
//
// The dead link: the rdyrct logo goes from "/#faq" to "/", the same route, so
// nothing remounts and an arrival-keyed effect never fires. It has to ride up
// anyway.
async function trackScroll(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const samples: { path: string; y: number; hero: boolean }[] = [];
    Object.assign(window, { __scrollSamples: samples });
    const tick = () => {
      samples.push({
        path: location.pathname,
        y: Math.round(window.scrollY),
        hero: /Know which channel/.test(document.querySelector("h1")?.textContent ?? ""),
      });
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function scrollSamples(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    // SAFETY: trackScroll put __scrollSamples on window in this same page, and
    // a client-side route change doesn't replace it.
    const { __scrollSamples } = window as typeof window & {
      __scrollSamples: { path: string; y: number; hero: boolean }[];
    };
    return __scrollSamples;
  });
}

/** How many distinct positions the page passed through: a jump has none. */
function travelled(ys: number[], from: number) {
  return new Set(ys.filter((y) => y > 0 && y < from)).size;
}

/** Partway down the landing page, tracking every frame from here on. */
async function atTheFaq(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("header nav").getByRole("link", { name: "FAQ" }).click();
  await expect(page.locator("#faq")).toBeInViewport();
  const start = await page.evaluate(() => window.scrollY);
  expect(start).toBeGreaterThan(0);
  await trackScroll(page);
  return start;
}

test("a marketing link swaps the page, then rides it to the top", async ({ page }) => {
  await atTheFaq(page);
  await page.locator("header nav").getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { level: 1, name: /simple pricing/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  const samples = await scrollSamples(page);
  // The landing page was never parked at its own top: that is the flash.
  expect(samples.filter((s) => s.hero && s.y === 0)).toHaveLength(0);
  // The new page got to the top by scrolling, not by jumping.
  const onPricing = samples.filter((s) => s.path === "/pricing" && !s.hero);
  expect(
    travelled(
      onPricing.map((s) => s.y),
      onPricing[0]!.y + 1,
    ),
  ).toBeGreaterThan(5);
});

test("the logo rides back to the top from a section link on the same page", async ({ page }) => {
  const start = await atTheFaq(page);
  await page.getByRole("link", { name: "rdyrct" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  const ys = (await scrollSamples(page)).map((s) => s.y);
  expect(travelled(ys, start)).toBeGreaterThan(5);
});

/**
 * Click Pricing with its chunk held open, so the navigation is still in
 * flight. Returns the release, plus the wait for the load actually landing:
 * asserting on a timeout instead lets a slow runner pass a regression.
 */
async function pricingClickInFlight(page: import("@playwright/test").Page) {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname.includes("routes/pricing"),
    async (route) => {
      await held;
      await route.continue();
    },
  );

  await page.locator("header nav").getByRole("link", { name: "Pricing" }).click();
  // The hold is what makes this a race at all: if the route ever stops
  // matching, the test would pass while exercising nothing.
  await expect(page).not.toHaveURL(/\/pricing$/);

  return async () => {
    release();
    await page.waitForResponse((response) => response.url().includes("routes/pricing"));
  };
}

// Two links clicked before the first one commits. The commit waits for the
// route to load, so the first load can settle after the second has already
// navigated: without a guard its `.finally()` sent the visitor to the page
// they gave up on. Holding the pricing chunk is what makes the race certain
// rather than a matter of timing.
test("a second marketing link wins over one still loading", async ({ page }) => {
  await page.goto("/");
  const settleTheAbandonedLoad = await pricingClickInFlight(page);
  await page.locator("footer").getByRole("link", { name: "QR generator" }).click();
  await expect(page).toHaveURL(/\/qr-code-generator$/);

  // The abandoned load finishing must not steal the page back.
  await settleTheAbandonedLoad();
  await expect(page).toHaveURL(/\/qr-code-generator$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/QR code/i);
});

// Same race, but the thing that interrupts is not another marketing link.
// The click counter cannot see those, so the commit checks the location has
// not moved: clicking Pricing on a cold chunk and then Sign up used to drop
// the visitor back on /pricing with a half-filled form behind them.
test("a stale marketing load cannot pull you off the page you moved to", async ({ page }) => {
  await page.goto("/");
  const settleTheAbandonedLoad = await pricingClickInFlight(page);
  await page.getByRole("link", { name: "Sign up" }).first().click();
  await expect(page).toHaveURL(/\/signup/);

  await settleTheAbandonedLoad();
  await expect(page).toHaveURL(/\/signup/);
});

// A link to the exact place you already are: no route change, so nothing
// remounts and no location dep moves. It still has to ride up, and it must
// not leave the scroll armed for whatever page comes next.
test("the logo rides up when you are already on the page it points at", async ({ page }) => {
  await page.goto("/");
  // The page has to be there before it can be scrolled: the shell on its own
  // is one viewport tall.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 2000, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const start = await page.evaluate(() => window.scrollY);

  await trackScroll(page);
  await page.getByRole("link", { name: "rdyrct" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    travelled(
      (await scrollSamples(page)).map((s) => s.y),
      start,
    ),
  ).toBeGreaterThan(5);
});

test("legal pages retain their baseline headings", async ({ page }) => {
  await visitLegalPages(page);
});

// A first-time visitor on a light operating system must land on light. The
// toggle then has to flip the page and survive a reload, which is the part
// that breaks if theme-init.js and lib/theme.ts disagree on the default.
test("landing page opens light and the toggle switches and sticks", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  const html = page.locator("html");

  await page.goto("/");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: /toggle theme/i }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await context.close();
});

// The stored choice wins over the operating system in both directions, so a
// dark-preferring visitor who picked light keeps light.
test("a dark operating system still opens dark by default", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await context.close();
});

test("the footer is the same width on every public page", async ({ page }) => {
  // The legal pages shared one container with their prose, so their footer
  // came out 720px against the landing page's 976: the rule above the links
  // visibly changed length when somebody followed a footer link, which is
  // the one journey that puts the two footers back to back.
  const widths: Record<string, number> = {};
  for (const path of ["/", "/privacy", "/terms"]) {
    await page.goto(path);
    const box = await page.locator("footer").boundingBox();
    widths[path] = Math.round(box?.width ?? 0);
  }

  expect(widths["/privacy"]).toBe(widths["/"]);
  expect(widths["/terms"]).toBe(widths["/"]);
  expect(widths["/"]).toBeGreaterThan(0);
});

test("the second screen argues with two messages, not two URLs (#96)", async ({ page }) => {
  await page.goto("/");
  // The point is made by showing the link where it is read. If this ever
  // becomes two URLs side by side again, it is back to asserting instead of
  // showing.
  await expect(page.getByText(/deciding whether to trust it/i)).toBeVisible();
  await expect(page.getByText("Deleted as spam")).toBeVisible();
  await expect(page.getByText("Obviously from Acme")).toBeVisible();
  await expect(page.getByRole("link", { name: /Put your domain on it/i })).toBeVisible();
});

test("a signed-out visitor still gets the anonymous shortener, not a dashboard card", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Try it without an account")).toBeVisible();
  await expect(page.getByText(/Welcome back/)).toHaveCount(0);
});
