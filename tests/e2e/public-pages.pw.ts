import { expect, test } from "@playwright/test";
import { visitLegalPages } from "./pages";

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

test("the hero has one CTA and self-hosting sits under pricing", async ({ page }) => {
  await page.goto("/");

  const hero = page.locator("section").first();
  await expect(hero.getByRole("link", { name: /self-host/i })).toHaveCount(0);
  await expect(hero.getByRole("link", { name: /see how it works/i })).toHaveCount(0);
  await expect(hero.getByRole("link", { name: "Get started free" })).toHaveAttribute(
    "href",
    /\/signup/,
  );

  // No star count in the pill: a low one reads as a weekend project to the
  // exact reader this band is for.
  const selfHost = page.locator("#self-host");
  const pill = selfHost.getByRole("link", { name: /github/i });
  await expect(pill).toHaveAttribute("href", /github\.com/);
  await expect(pill).not.toContainText(/\d|star/i);
});

test("the homepage teases three prices and points at the full comparison", async ({ page }) => {
  await page.goto("/");

  const teaser = page.locator("#pricing");
  await expect(teaser).not.toContainText(/self-hosted/i);
  await expect(teaser.getByText("Free", { exact: true })).toBeVisible();
  await expect(teaser.getByText("Hobby", { exact: true })).toBeVisible();
  await expect(teaser.getByText("Best value")).toBeVisible();
  await expect(teaser.getByText("Most popular")).toHaveCount(0);
  await expect(teaser.locator("table")).toHaveCount(0);

  const free = teaser.getByText("Free", { exact: true }).locator("xpath=ancestor::div[1]");
  await expect(free).toContainText(/members/i);
  await expect(free).toContainText(/always random/i);

  await teaser.getByRole("link", { name: /full comparison/i }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

test("header navigation and sign-up remain usable on desktop and phone", async ({ page }) => {
  await page.goto("/");

  // The entry chunk's header is swapped for the page's own, which mounts closed:
  // opening Product before the swap raced it.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const header = page.locator("header");
  const nav = header.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Pricing" })).toBeVisible();

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

// The path to a link in the panel's far corner leaves the button sideways over
// the nav padding. Moving along the nav means another item, so it closes.
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

test("the phone menu opens, leads somewhere, and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");

  // Wait for the header swap, so the menu is the one that stays.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const header = page.locator("header");
  const menu = header.getByRole("navigation", { name: "Menu" });
  await expect(menu).toBeHidden();

  await header.getByRole("button", { name: "Open menu" }).click();
  await expect(menu).toBeVisible();
  await expect(header.getByRole("link", { name: "Get started" })).toBeVisible();
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

// The homepage is a lazy chunk: held on the dev server's route module so the
// assertions run while it is in flight.
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
  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();

  release();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(header).toHaveCount(1);
});

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

// Nothing asserts the scroll-to-top ride: the old tests sampled
// requestAnimationFrame and measured the CI runner's frame rate. If it needs a
// guard again, assert where the page ends up, not frame counts.

/** Holds the pricing chunk so navigation is in flight. Waits for the load to
 * land: a timeout would let a slow runner pass a regression. */
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
  // The hold makes this a race: if the route stops matching, the test would
  // pass while exercising nothing.
  await expect(page).not.toHaveURL(/\/pricing$/);

  return async () => {
    release();
    await page.waitForResponse((response) => response.url().includes("routes/pricing"));
  };
}

// Two links clicked before the first commits: its `.finally()` used to send the
// visitor to the page they gave up on. Holding the chunk makes the race certain.
test("a second marketing link wins over one still loading", async ({ page }) => {
  await page.goto("/");
  const settleTheAbandonedLoad = await pricingClickInFlight(page);
  await page.locator("footer").getByRole("link", { name: "QR generator" }).click();
  await expect(page).toHaveURL(/\/qr-code-generator$/);

  await settleTheAbandonedLoad();
  await expect(page).toHaveURL(/\/qr-code-generator$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/QR code/i);
});

// The click counter cannot see non-marketing interruptions, so the commit checks
// the location has not moved: Pricing then Sign up used to land on /pricing.
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

// The toggle must survive a reload: that breaks if the inline bootstrap and
// lib/theme.ts disagree on the default.
test("landing page opens light and the toggle switches and sticks", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  const html = page.locator("html");

  await page.goto("/");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await context.close();
});

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

test("the developer claim is backed by a roadmap of real issues", async ({ page }) => {
  await page.goto("/roadmap");
  await expect(
    page.getByRole("heading", { level: 1, name: /what we are building/i }),
  ).toBeVisible();

  const issues = page.locator('a[href*="/issues/"]');
  await expect(issues).not.toHaveCount(0);
  for (const href of await issues.evaluateAll((links) =>
    links.map((l) => l.getAttribute("href")),
  )) {
    expect(href).toMatch(/^https:\/\/github\.com\/baronunread\/rdyrct\/issues\/(new|\d+)$/);
  }

  for (const stage of ["Next", "Later", "Shipped"]) {
    const column = page.getByRole("region", { name: new RegExp(`^${stage}`) });
    await expect(column).toBeVisible();
    const count = Number(
      await column.getByRole("heading", { level: 2 }).locator("span").innerText(),
    );
    await expect(column.getByRole("listitem")).toHaveCount(count);
  }
});

test("the docs are reachable from the landing, the roadmap from the footer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /API and MCP docs/i }).click();
  await expect(page).toHaveURL(/\/docs$/);

  await page.goto("/pricing");
  await page.locator("footer").getByRole("link", { name: "Roadmap" }).click();
  await expect(page).toHaveURL(/\/roadmap$/);
});

test("the analytics preview ends on an ask", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");

  const ask = page.locator("#analytics").getByRole("link", { name: /on your own links/i });
  await ask.scrollIntoViewIfNeeded();
  await expect(ask).toBeVisible();
  await ask.click();
  await expect(page).toHaveURL(/\/signup/);
});

test("signup carries context across the door", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText(/then check out/i)).toBeHidden();

  await page.goto("/signup?next=%2Fwelcome%3Fplan%3Dpro");
  await expect(page.getByText(/then check out/i)).toBeVisible();
  await page.goto("/signup?next=%2Fbilling%3Fplan%3Dpro");
  await expect(page.getByText(/then check out/i)).toBeVisible();
});

test("the footer has a cookie policy that lands on the cookie section", async ({ page }) => {
  await page.goto("/");
  await page.locator("footer").getByRole("link", { name: "Cookies" }).click();

  await expect(page).toHaveURL(/\/privacy#cookies$/);
  await expect(page.locator("#cookies")).toBeInViewport();
});

// The Compare links go to the blog, a separate Worker: real addresses, not SPA routes.
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

test("the compare index lists each tool and opens its comparison", async ({ page }) => {
  await page.goto("/");
  await page.locator("footer").getByRole("link", { name: "All comparisons" }).click();
  await expect(page).toHaveURL(/\/compare$/);
  for (const name of [
    "Bitly",
    "Rebrandly",
    "Dub",
    "Short.io",
    "TinyURL",
    "Flowcode",
    "QR Code Monkey",
  ]) {
    await expect(page.getByRole("heading", { name: `vs ${name}` })).toBeVisible();
  }
  await page.getByRole("link", { name: /vs Dub/ }).click();
  await expect(page).toHaveURL(/\/dub-alternative$/);
});

for (const { path, name } of [
  { path: "/bitly-alternative", name: "Bitly" },
  { path: "/rebrandly-alternative", name: "Rebrandly" },
  { path: "/dub-alternative", name: "Dub" },
  { path: "/short-io-alternative", name: "Short.io" },
  { path: "/tinyurl-alternative", name: "TinyURL" },
  { path: "/flowcode-alternative", name: "Flowcode" },
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

// The Vite dev server answers /@vite/client and every source module through
// serveSpa's fallback: caching those keeps the browser running stale code.
// Guarded by import.meta.env.DEV.
test("the dev server never hands out a long cache for a source module", async ({ request }) => {
  for (const path of ["/@vite/client", "/src/app/main.tsx"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["cache-control"] ?? "", path).not.toContain("max-age=3600");
  }
});

// A 404 for /@react-refresh (the runtime the dev server injects) means React
// never mounts and the hidden crawler block shows instead. Only the shell may
// become a 404. The production suite cannot see it.
test("the single-segment files the dev server owns are not 404s", async ({ request }) => {
  for (const path of ["/@react-refresh", "/favicon.svg", "/og.png", "/llms.txt"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

// index.html ships a hidden block of crawler copy, so a page whose JavaScript
// never ran still has an h1. Assert the router mounted by asking for something
// only the app renders.
test("the app actually mounts, rather than leaving the crawler block on screen", async ({
  page,
}) => {
  await page.goto("/roadmap");

  await expect(
    page.getByRole("heading", { level: 1, name: /what we are building/i }),
  ).toBeVisible();
  await expect(page.locator("header").getByRole("link", { name: "Sign up" })).toBeVisible();
});

// Exactly one main, not at least one: two is the same as none.
test("every public page has one main landmark", async ({ page }) => {
  for (const path of ["/", "/qr-code-generator", "/pricing", "/roadmap", "/privacy", "/terms"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("main"), `main landmark on ${path}`).toHaveCount(1);
  }
});

// A stranger has no session, so /user could only 401 and log a page error.
// Skipping the request must not make a signed-out visitor look signed in.
test("a first visit does not ask who it is", async ({ page }) => {
  const userCalls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/user") userCalls.push(r.url());
  });

  await page.goto("/");
  await expect(page.locator("header").getByRole("link", { name: "Sign up" })).toBeVisible();
  // The header paints before the page mounts, so asserting there passed against
  // a build that still made the call: wait for every section. Not network idle:
  // product analytics can keep an unrelated request open.
  await openTourAnalytics(page);

  expect(userCalls, "a browser that was never signed in has nothing to ask").toEqual([]);
});

// The charts bundle is 117 KB: a visitor who reads the whole page must not
// download it.
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

// #137: a public page points at its machine-readable copy (RFC 8288). The app
// behind the login does not.
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

test("header and footer carry the logo, named by the word alone", async ({ page }) => {
  await page.goto("/");

  for (const region of [page.getByRole("banner"), page.getByRole("contentinfo")]) {
    const home = region.getByRole("link", { name: "rdyrct", exact: true });
    await expect(home).toBeVisible();
    await expect(home.locator("svg[aria-hidden='true']")).toBeVisible();
  }
});
