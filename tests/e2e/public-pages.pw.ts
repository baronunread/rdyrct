import { expect, test } from "@playwright/test";
import { visitLegalPages } from "./pages";

/** Scroll to the analytics section, whose first panel draws with the lazy
 * charts bundle, then wait for the chart itself. */
/** Down to the last landing section, so every section has mounted. */
async function openTourAnalytics(page: import("@playwright/test").Page) {
  await page.locator("#analytics").scrollIntoViewIfNeeded();
  await expect(
    page.locator("#analytics").getByRole("heading", { level: 3, name: "Clicks over time" }),
  ).toBeVisible();
}

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
// page to GitHub (#96), and after that a button that only scrolled a few
// hundred pixels. It has one CTA now, and the self-host link has to still
// exist, further down, under pricing.
test("the hero has one CTA and self-hosting sits under pricing", async ({ page }) => {
  await page.goto("/");

  const hero = page.locator("section").first();
  await expect(hero.getByRole("link", { name: /self-host/i })).toHaveCount(0);
  await expect(hero.getByRole("link", { name: /see how it works/i })).toHaveCount(0);
  await expect(hero.getByRole("link", { name: "Get started free" })).toHaveAttribute(
    "href",
    /\/signup/,
  );

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
  // "Best value", which the limits back; never "Most popular", which
  // nothing does.
  await expect(teaser.getByText("Best value")).toBeVisible();
  await expect(teaser.getByText("Most popular")).toHaveCount(0);
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

test("header navigation and sign-up remain usable on desktop and phone", async ({ page }) => {
  await page.goto("/");

  // The header the entry chunk paints first is swapped for the page's own
  // once the homepage chunk arrives, and the new one mounts closed. Opening
  // Product on the stand-in raced that swap: the panel shut under the test.
  // The heading comes with the page, so after it the header stays put.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const header = page.locator("header");
  const nav = header.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Pricing" })).toBeVisible();

  // Product is a disclosure: its panel holds the pages that used to be
  // reachable only from the footer, and Escape hands focus back.
  const product = nav.getByRole("button", { name: "Product" });
  await product.click();
  await expect(product).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: /QR code generator/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(product).toHaveAttribute("aria-expanded", "false");
  await expect(product).toBeFocused();

  await nav.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(nav.getByRole("link", { name: "Pricing" })).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");
  await expect(nav).toBeHidden();
  await expect(header.getByRole("link", { name: "Sign up" })).toBeVisible();
  await header.getByRole("link", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/signup/);
});

// Hovering Product opens its panel, and the panel has to survive the trip to
// a link in its far corner: that path leaves the button sideways, over the
// nav's padding, before it reaches the panel. Moving along the nav instead
// means somebody went for another item, and the panel gets out of the way.
test("the Product panel stays open on the way to its far corner, not along the nav", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const nav = page.locator("header").getByRole("navigation", { name: "Main" });
  const product = nav.getByRole("button", { name: "Product" });
  const button = await product.boundingBox();
  if (!button) throw new Error("the Product button has no box");
  const start = { x: button.x + button.width / 2, y: button.y + button.height / 2 };

  await page.mouse.move(start.x, start.y);
  await expect(product).toHaveAttribute("aria-expanded", "true");
  const far = nav.locator("#product-panel a").last();
  await expect(far).toBeVisible();
  const target = await far.boundingBox();
  if (!target) throw new Error("the far link has no box");
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 60 });
  await expect(product).toHaveAttribute("aria-expanded", "true");
  await far.click();
  await expect(page).not.toHaveURL(/\/$/);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.mouse.move(start.x, start.y);
  await expect(product).toHaveAttribute("aria-expanded", "true");
  const docs = await nav.getByRole("link", { name: "Docs" }).boundingBox();
  if (!docs) throw new Error("Docs has no box");
  await page.mouse.move(docs.x + docs.width / 2, start.y, { steps: 8 });
  await expect(product).toHaveAttribute("aria-expanded", "false");
});

// On a phone the pill opens into a card with every page in it; before this
// the only way to Pricing on a phone was the footer.
test("the phone menu opens, leads somewhere, and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");

  // The header the entry chunk paints first is swapped for the page's own
  // once the page arrives; wait for that, so the menu is the one that stays.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const header = page.locator("header");
  const menu = header.getByRole("navigation", { name: "Menu" });
  await expect(menu).toBeHidden();

  await header.getByRole("button", { name: "Open menu" }).click();
  await expect(menu).toBeVisible();
  await expect(header.getByRole("link", { name: "Get started" })).toBeVisible();
  // The page under the card holds still while it is open.
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(header.getByRole("button", { name: "Open menu" })).toBeFocused();

  await header.getByRole("button", { name: "Open menu" }).click();
  await menu.getByRole("link", { name: /Pricing/ }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
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

  await expect(
    page.getByRole("heading", { level: 1, name: /URL shortener pricing/i }),
  ).toBeVisible();
  const headers = page.locator("#pricing thead th");
  await expect(headers).toHaveCount(4);
  await expect(headers.nth(2)).toContainText("Hobby");
  await expect(page.locator("#self-host")).toHaveCount(0);

  await page.getByRole("link", { name: "Sign up" }).first().click();
  await expect(page).toHaveURL(/\/signup/);
});

// Most products put a screenshot in the hero because you cannot use them
// logged out; ours works with no account, so the real shortener sits under the
// pitch, in front of the globe, with the one primary CTA above it.
test("the hero keeps its shortener and primary path usable on desktop and phone", async ({
  page,
}) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  const card = page.getByLabel("Shorten a link, no account needed");
  await expect(heading).toBeVisible();
  await expect(card).toBeVisible();

  const hero = page.locator("section").first();
  await expect(hero.getByRole("link", { name: /get started free/i })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.getByLabel("Shorten a link, no account needed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Shorten it" })).toBeDisabled();
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

  // The control lives in the footer, not the header, so it is below the fold.
  await page.getByRole("button", { name: "Dark theme" }).click();
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
// open issues, and both the developers tab and the footer have to lead there.
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

  // A board, one column per stage, each saying how much is in it. A roadmap
  // made only of things that do not exist reads as a product that does not
  // exist, so the shipped column has to be there too.
  for (const stage of ["Next", "Later", "Shipped"]) {
    const column = page.getByRole("region", { name: new RegExp(`^${stage}`) });
    await expect(column).toBeVisible();
    const count = Number(
      await column.getByRole("heading", { level: 2 }).locator("span").innerText(),
    );
    await expect(column.getByRole("listitem")).toHaveCount(count);
  }
});

// The landing sells an API and MCP server that ship today, so it points at
// their docs, not at the roadmap.
test("the docs are reachable from the landing, the roadmap from the footer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /API and MCP docs/i }).click();
  await expect(page).toHaveURL(/\/docs$/);

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

// A cold signup is bare (no subtitle), but arriving with context keeps it:
// a link waiting to be claimed, or a checkout the visitor was mid-way into.
test("signup carries context across the door", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText(/then check out/i)).toBeHidden();

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

// The footer groups its links under Product, Compare and Company. The Compare
// links point into the blog, which is a separate Worker, so they have to be
// real addresses rather than SPA routes.
test("the footer groups its links and the compare links lead to the comparison pages", async ({
  page,
}) => {
  await page.goto("/");
  const footer = page.locator("footer");
  for (const heading of ["Product", "Compare", "Company"]) {
    await expect(footer.getByText(heading, { exact: true })).toBeVisible();
  }
  await expect(footer.getByRole("link", { name: "Bitly alternative" })).toHaveAttribute(
    "href",
    "/bitly-alternative",
  );
  await expect(footer.getByRole("link", { name: "Dub alternative" })).toHaveAttribute(
    "href",
    "/dub-alternative",
  );
});

// The changelog is CHANGELOG.md rendered, so the release in the file has to be
// the release on the page, and the pricing page has to lead to the comparisons.
test("the changelog shows the latest release and pricing links to the comparisons", async ({
  page,
}) => {
  await page.goto("/changelog");
  await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "1.0.0" })).toBeVisible();
  await page.goto("/pricing");
  await page.getByRole("link", { name: "See how rdyrct compares" }).click();
  await expect(page).toHaveURL(/\/compare$/);
});

// The index behind "All comparisons" lists every tool and links to its page.
test("the compare index lists each tool and opens its comparison", async ({ page }) => {
  await page.goto("/");
  await page.locator("footer").getByRole("link", { name: "All comparisons" }).click();
  await expect(page).toHaveURL(/\/compare$/);
  for (const name of ["Bitly", "Rebrandly", "Dub", "Short.io", "TinyURL"]) {
    await expect(page.getByRole("heading", { name: `vs ${name}` })).toBeVisible();
  }
  await page.getByRole("link", { name: /vs Dub/ }).click();
  await expect(page).toHaveURL(/\/dub-alternative$/);
});

// Each comparison page names the other tool, shows both columns of the
// table, and says where the other tool wins: a page that only flatters
// rdyrct is the page nobody believes.
for (const { path, name } of [
  { path: "/bitly-alternative", name: "Bitly" },
  { path: "/rebrandly-alternative", name: "Rebrandly" },
  { path: "/dub-alternative", name: "Dub" },
  { path: "/short-io-alternative", name: "Short.io" },
  { path: "/tinyurl-alternative", name: "TinyURL" },
]) {
  test(`${path} compares rdyrct with ${name}, including where ${name} wins`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page.getByRole("columnheader", { name, exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `Where ${name} is the better choice` }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Where rdyrct is the better choice" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Sign up free" }).click();
    await expect(page).toHaveURL(/\/signup/);
  });
}

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
  // mounted, down to the analytics cards. Waiting for network
  // idle is wrong here: product analytics can keep an unrelated request open.
  await openTourAnalytics(page);

  expect(userCalls, "a browser that was never signed in has nothing to ask").toEqual([]);
});

// The charts bundle is 117 KB, the largest single thing the app has. The
// homepage drew one chart with it once; its analytics cards are plain markup
// now, so a visitor who reads the whole page never downloads it.
test("the homepage never asks for the charts bundle", async ({ page }) => {
  const charts: string[] = [];
  page.on("request", (r) => {
    if (/\/assets\/charts-|\/components\/charts/.test(r.url())) charts.push(r.url());
  });

  await page.goto("/");
  await openTourAnalytics(page);
  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  expect(charts).toEqual([]);
});

// #137: a public page points at what describes it (RFC 8288), so an agent
// that fetches one learns where the machine-readable copy lives instead of
// guessing at well-known paths. Only the pages we describe carry it: the app
// behind the login wants no such traffic.
test("public pages point at their machine-readable description", async ({ request }) => {
  for (const path of ["/", "/pricing", "/qr-code-generator", "/privacy", "/terms"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["link"] ?? "", path).toContain(
      '</llms.txt>; rel="describedby"; type="text/plain"',
    );
  }

  const dashboard = await request.get("/dashboard");
  expect(dashboard.headers()["link"] ?? "").toBe("");
});

// A keyboard user's first Tab on the homepage lands on a way past the header,
// and following it puts them in the main landmark rather than on the nav.
test("the homepage's first Tab is a skip link into main", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect(page.getByRole("main")).toHaveAttribute("id", "main");
});

// The Hop mark sits next to the name in the header and the footer. The mark is
// decoration, so the link still reads as the bare name to a screen reader and
// to every test that finds it by "rdyrct".
test("header and footer carry the logo, named by the word alone", async ({ page }) => {
  await page.goto("/");

  for (const region of [page.getByRole("banner"), page.getByRole("contentinfo")]) {
    const home = region.getByRole("link", { name: "rdyrct", exact: true });
    await expect(home).toBeVisible();
    await expect(home.locator("svg[aria-hidden='true']")).toBeVisible();
  }
});
