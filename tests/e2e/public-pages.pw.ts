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
  // The pill used to end on a star count, which is the wrong number to make
  // the largest fact in the section that answers "will this still be here next
  // year": a low count reads as a weekend project to the exact reader the band
  // is for. No number belongs in it now.
  const selfHost = page.locator("#self-host");
  const pill = selfHost.getByRole("link", { name: /github/i });
  await expect(pill).toHaveAttribute("href", /github\.com/);
  await expect(pill).not.toContainText(/\d|star/i);
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
  await expect(teaser.getByText("Most popular")).toBeVisible();
  await expect(teaser.locator("table")).toHaveCount(0);

  // The free plan has to say the generous part and the catch in the same
  // breath: three teammates is the strongest free thing here, and random
  // slugs is the fact somebody feels lied to about if they only meet it
  // after signing up.
  const free = teaser.getByText("Free", { exact: true }).locator("xpath=ancestor::div[1]");
  await expect(free).toContainText(/teammates/i);
  await expect(free).toContainText(/always random/i);

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
  const card = page.getByLabel("Shorten a link, no account needed");
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
  // one thing on this page that turns a stranger into an account. Assert the
  // stack itself, not just that the card is somewhere on screen.
  await page.setViewportSize({ width: 390, height: 780 });
  const hNarrow = (await heading.boundingBox())!;
  const cNarrow = (await card.boundingBox())!;
  expect(cNarrow.y).toBeGreaterThan(hNarrow.y + hNarrow.height - 1);
  expect(cNarrow.x).toBeLessThan(hNarrow.x + hNarrow.width);
  await expect(card).toBeInViewport();
});

// Marketing navigation swaps the content where you stand and then rides the
// new page up to its top, which is the order resend.com uses. Nothing asserts
// the ride any more. The three tests that did sampled requestAnimationFrame
// and demanded six distinct positions to call a scroll a scroll, which a
// loaded CI runner cannot supply: they measured the runner's frame rate, not
// the app, and went red for it. If this needs a guard again, assert where the
// page ends up rather than how many frames it took to get there.

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

test("legal pages retain their baseline headings", async ({ page }) => {
  await visitLegalPages(page);
});

// A first-time visitor on a light operating system must land on light. The
// toggle then has to flip the page and survive a reload, which is the part
// that breaks if the inline bootstrap and lib/theme.ts disagree on the default.
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
  await expect(page.getByText(/click links they recognize/i)).toBeVisible();
  await expect(page.getByText("Doesn't match the sender")).toBeVisible();
  await expect(page.getByText("Matches the sender")).toBeVisible();
  await expect(page.getByRole("link", { name: /Connect your domain/i })).toBeVisible();

  // Sold on recognition, the way every competitor sells it, not by making
  // somebody picture being taken for a scammer. Bitly sells against a
  // generic shortener domain and still never says the word.
  const section = page.locator("section").filter({ hasText: /click links they recognize/i });
  await expect(section).not.toContainText(/scam|spam|fraud/i);
});

test("a signed-out visitor still gets the anonymous shortener, not a dashboard card", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Shorten a link, no account needed")).toBeVisible();
  await expect(page.getByText(/Welcome back/)).toHaveCount(0);
});

// The page claims it serves developers, and every feature card on it is a
// marketer's feature: there is no API in the product yet. The roadmap page is
// what makes the claim honest, so it has to exist, it has to point at real
// open issues, and both the feature grid and the footer have to lead there.
test("the developer claim is backed by a roadmap of real issues", async ({ page }) => {
  await page.goto("/roadmap");
  await expect(
    page.getByRole("heading", { level: 1, name: /what we are building/i }),
  ).toBeVisible();

  // Every planned card links to the issue that promises it. None of it is
  // built, so the issue is the only evidence the page has.
  const issues = page.locator('a[href*="/issues/"]');
  await expect(issues).not.toHaveCount(0);
  for (const href of await issues.evaluateAll((links) =>
    links.map((l) => l.getAttribute("href")),
  )) {
    expect(href).toMatch(/^https:\/\/github\.com\/baronunread\/rdyrct\/issues\/(new|\d+)$/);
  }

  // A roadmap made only of things that do not exist reads as a product that
  // does not exist, so the shipped half has to be there too.
  await expect(page.getByRole("heading", { name: /already working/i })).toBeVisible();
});

test("the roadmap is reachable from the footer and from the feature grid", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /the API is on the roadmap/i }).click();
  await expect(page).toHaveURL(/\/roadmap$/);

  await page.goto("/pricing");
  await page.locator("footer").getByRole("link", { name: "Roadmap" }).click();
  await expect(page).toHaveURL(/\/roadmap$/);
});

// Between the hero and the pricing cards the page runs about 6,200px on a
// phone with nothing to click. The analytics preview ends on the one ask in
// that stretch, placed where somebody has just been shown the payoff.
test("the analytics preview ends on an ask", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");

  const ask = page.locator("#analytics").getByRole("link", { name: /on your own links/i });
  await ask.scrollIntoViewIfNeeded();
  await expect(ask).toBeVisible();
  await ask.click();
  await expect(page).toHaveURL(/\/signup/);
});

// Signup used to render the same card whether you arrived cold or clicked
// "Keep this link" with a link waiting. The subtitle is what carries the
// context across the door, and the default has to name the emailed code:
// that is the step people abandon.
test("signup says what happens next", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText(/6-digit code/i)).toBeVisible();

  await page.goto("/signup?next=%2Fbilling%3Fplan%3Dpro");
  await expect(page.getByText(/then check out/i)).toBeVisible();
});

// The cookie policy is a section of the privacy page, not a page of its own:
// two documents saying the same thing drift. It still needs its own address,
// because that is what people (and the scanners that audit for one) look for.
test("the footer has a cookie policy that lands on the cookie section", async ({ page }) => {
  await page.goto("/");
  await page.locator("footer").getByRole("link", { name: "Cookies" }).click();

  await expect(page).toHaveURL(/\/privacy#cookies$/);
  await expect(page.locator("#cookies")).toBeInViewport();
});

// serveSpa gives the unhashed static files an hour-long cache. This same
// fallback is what the Vite dev server answers /@vite/client and every source
// module through, and caching those means the browser keeps running the code
// you just edited: the app looks broken and a reload does not fix it. Guarded
// by import.meta.env.DEV, which only this project can see.
test("the dev server never hands out a long cache for a source module", async ({ request }) => {
  for (const path of ["/@vite/client", "/src/app/main.tsx"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["cache-control"] ?? "", path).not.toContain("max-age=3600");
  }
});

// Every single-segment path reaches the /:slug handler, misses, and lands in
// serveSpa asking for a 404. Only the shell may actually become one: the rest
// are real files. /@react-refresh is the one that hurts, because it is the
// React Refresh runtime the dev server injects into index.html, and a 404
// there means React never mounts and every page renders the hidden crawler
// block instead. The production suite could not see it: that path only exists
// while Vite is serving.
test("the single-segment files the dev server owns are not 404s", async ({ request }) => {
  for (const path of ["/@react-refresh", "/favicon.svg", "/og.png", "/llms.txt"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

// The check the two above exist for. index.html ships a hidden block of real
// copy for crawlers, so a page whose JavaScript never ran still answers with
// an h1 and looks alive to anything reading the HTML. That is exactly what
// made a totally dead app hard to spot: assert the router mounted, by asking
// for something only the app renders.
test("the app actually mounts, rather than leaving the crawler block on screen", async ({
  page,
}) => {
  await page.goto("/roadmap");

  await expect(
    page.getByRole("heading", { level: 1, name: /what we are building/i }),
  ).toBeVisible();
  // The crawler block is clipped to 1px and has no header; the app has one.
  await expect(page.locator("header").getByRole("link", { name: "Sign up" })).toBeVisible();
});

// Every page owes a screen-reader user one main landmark: it is what "skip to
// content" skips to, and without it the only way past the header and its nav
// is to walk them link by link, on every page, every visit. The app shell has
// had one all along; the public pages, which are the ones strangers land on,
// had none.
//
// Exactly one, not at least one: two mains is the same as none, since neither
// is then "the content".
test("every public page has one main landmark", async ({ page }) => {
  for (const path of ["/", "/qr-code-generator", "/pricing", "/roadmap", "/privacy", "/terms"]) {
    await page.goto(path);
    // The header renders before the page chunk, so wait for the page itself.
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("main"), `main landmark on ${path}`).toHaveCount(1);
  }
});

// A stranger has no session, so asking /user who they are could only ever come
// back 401, and the browser logs every one of those as a page error. First
// visit to the homepage, which is the visit that matters most, opened the
// console on an error. The header still has to come out right, which is the
// second half of this test: skipping the request must not make a signed-out
// visitor look signed in.
test("a first visit does not ask who it is", async ({ page }) => {
  const userCalls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/user") userCalls.push(r.url());
  });

  await page.goto("/");
  await expect(page.locator("header").getByRole("link", { name: "Sign up" })).toBeVisible();
  // The header paints before the rest of the page has even mounted, so
  // asserting here caught nothing: the first version of this test passed
  // against a build that still made the call. Every section has to have
  // mounted, including the ones that ask this to decide where a CTA points,
  // and the lazy analytics mock has to have landed.
  await page
    .getByRole("link", { name: /start pro/i })
    .first()
    .scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");

  expect(userCalls, "a browser that was never signed in has nothing to ask").toEqual([]);
});

// The charts bundle is 117 KB, the largest single thing the homepage can
// fetch, and it exists to draw one decorative mock most of a screen down.
// Lazy alone was not enough: the chunk still went out to everybody who opened
// the page, it just stopped blocking the paint. It must not be requested until
// the visitor is heading for it.
test("the charts bundle waits until the visitor scrolls toward it", async ({ page }) => {
  const charts: string[] = [];
  page.on("request", (r) => {
    if (/\/assets\/charts-|\/components\/charts/.test(r.url())) charts.push(r.url());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(charts, "nothing above the fold needs the charts bundle").toEqual([]);

  // Now go to it. The section renders its placeholder either way, so wait for
  // the chart the bundle is actually for.
  await page.locator("#analytics").scrollIntoViewIfNeeded();
  await expect(page.locator("#analytics").getByLabel("Clicks per day")).toBeVisible();
  expect(charts.length, "and it arrives once they do").toBeGreaterThan(0);
});

// The placeholder exists to hold the mock's exact footprint, so nothing below
// it moves when the real thing lands. Its heights are hand-written numbers
// against a component that relayouts twice (bar lists at sm, heatmap at md),
// which is a pairing that goes stale silently: the swap happens 600px before
// the section is on screen, so a wrong height still measures as CLS 0 while
// shifting the page for anyone who scrolls fast. The first version of these
// heights was short by up to 703px and looked fine.
//
// One width per layout the mock has.
test("the analytics placeholder reserves exactly what the mock takes", async ({ page }) => {
  for (const width of [390, 700, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const slot = page.locator("#analytics").locator("div.flex.justify-center").first();
    await expect(slot).toBeVisible();
    const reserved = (await slot.boundingBox())!.height;

    await page.locator("#analytics").scrollIntoViewIfNeeded();
    await expect(page.locator("#analytics").getByLabel("Clicks per day")).toBeVisible();
    const actual = (await slot.boundingBox())!.height;

    expect(Math.abs(actual - reserved), `reserved height at ${width}px`).toBeLessThan(8);
  }
});
