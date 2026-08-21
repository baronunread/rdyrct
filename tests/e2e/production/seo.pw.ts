import { expect, test } from "@playwright/test";

/**
 * The head a crawler actually receives, from the built Worker and the real
 * asset bundle.
 *
 * Fetched rather than rendered: the clients this is for (Slack, WhatsApp,
 * iMessage, Discord, and Bing's first pass) read the bytes and never run a
 * line of the page's JavaScript. A title set on mount would pass a rendered
 * check and still be wrong for every one of them.
 */

const PAGES = [
  { path: "/", title: /URL shortener and QR code generator/ },
  { path: "/qr-code-generator", title: /Free QR code generator with logo/ },
  { path: "/pricing", title: /Pricing - rdyrct/ },
  { path: "/signup", title: /Sign up/ },
  { path: "/privacy", title: /Privacy policy/ },
];

test("each public page arrives with its own title", async ({ request }) => {
  for (const { path, title } of PAGES) {
    const html = await (await request.get(path)).text();
    const found = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    expect(found, `title of ${path}`).toMatch(title);
  }
});

test("each public page points its canonical at itself", async ({ request }) => {
  for (const { path } of PAGES) {
    const html = await (await request.get(path)).text();
    const canonical = /rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(new URL(canonical).pathname, `canonical of ${path}`).toBe(path);
  }
});

test("the QR page describes itself in the share tags, not the landing page", async ({
  request,
}) => {
  const html = await (await request.get("/qr-code-generator")).text();

  expect(html).toMatch(/"og:title" content="Free QR code generator/);
  expect(html).toMatch(/"og:description" content="Make a custom QR code online for free/);
  expect(html).toMatch(/"og:url" content="[^"]*\/qr-code-generator"/);
});

test("the signed-in app keeps the default head", async ({ request }) => {
  // Nothing behind the login wants search traffic.
  const html = await (await request.get("/dashboard")).text();

  expect(html).toContain("<title>rdyrct - URL shortener and QR code generator</title>");
});

test("robots.txt declares both sitemaps", async ({ request }) => {
  // The blog is a separate Worker (rdyrct-blog) with its own sitemap, built
  // by @astrojs/sitemap as sitemap-index.xml. Naming only the app's own
  // sitemap left posts undiscoverable outside crawling the blog's
  // pagination directly.
  const robots = await (await request.get("/robots.txt")).text();

  expect(robots).toContain("Sitemap: https://rdyrct.com/sitemap.xml");
  expect(robots).toContain("Sitemap: https://rdyrct.com/blog/sitemap-index.xml");
});

// What the live site serves is two sources merged: Cloudflare puts a managed
// block above whatever the origin returns, carrying the content signals and
// the AI training crawlers it refuses by name. This suite runs against a local
// preview of the built worker, so it sees the origin half only. That half is
// the part this repo owns and the part a bad edit here would break: the paths
// that want no search traffic.
//
// The managed half is a switch in the Cloudflare dashboard with nothing in git
// behind it. Checking it needs a request to the real hostname, which no suite
// here makes.
test("robots.txt keeps the private routes out of the index", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();

  for (const path of ["/api/", "/dashboard", "/admin", "/billing", "/settings"]) {
    expect(robots).toContain(`Disallow: ${path}`);
  }
});

test("a slug that resolves to nothing answers 404", async ({ request }) => {
  // Served under a 200 this is a soft 404: the shell's canonical points at the
  // landing page, so every mistyped or expired short link asked to be indexed
  // as a duplicate of the home page.
  const res = await request.get("/no-such-slug-9f3a2", { failOnStatusCode: false });

  expect(res.status()).toBe(404);
  // Still the SPA, which renders its own NotFound page over this response.
  expect(await res.text()).toContain('<div id="root">');
});

test("the second visit to a dead slug still renders the page", async ({ request }) => {
  // Regression: the 404 used to go out carrying the shell's ETag and
  // `must-revalidate`, so the browser cached it, revalidated on the next
  // visit, and got a 304 with no body — a blank white page where the
  // NotFound screen belongs, on every mistyped short link, from the second
  // visit onwards.
  const first = await request.get("/no-such-slug-7d2e1", { failOnStatusCode: false });
  expect(first.status()).toBe(404);
  expect((await first.body()).length, "the 404 should carry the page").toBeGreaterThan(0);

  // Nothing to revalidate against, and nothing stored to revalidate.
  expect(first.headers()["cache-control"]).toBe("no-store");
  expect(first.headers()["etag"]).toBeUndefined();

  // And if a client asks conditionally anyway (an entry cached before this
  // shipped), it still gets a body rather than an empty 304-turned-404.
  const second = await request.get("/no-such-slug-7d2e1", {
    headers: { "If-None-Match": '"whatever-it-had-before"' },
    failOnStatusCode: false,
  });
  expect((await second.body()).length, "a conditional request must not empty it").toBeGreaterThan(
    0,
  );
});

test("a file the bundle serves at the root still answers 200", async ({ request }) => {
  // These reach the slug handler by the same door as a dead link: one segment,
  // not a reserved keyword. 404ing them took /theme-init.js down with the
  // rest, so every page rendered a flash of the wrong theme, and the browser
  // suite is the only place that could see it — the worker tests stub ASSETS,
  // so everything there is the SPA shell and this looks fine.
  //
  // The content type is half the assertion, not decoration: serveSpa decides
  // whether a path may carry a 404 by asking whether what came back is HTML,
  // so a bundle that answered /favicon.svg with the SPA shell would satisfy a
  // status-only check while serving the wrong bytes.
  const assets = [
    ["/favicon.svg", "image/svg+xml"],
    ["/theme-init.js", "javascript"],
    ["/og.png", "image/png"],
    ["/llms.txt", "text/plain"],
  ];
  for (const [path, type] of assets) {
    const res = await request.get(path, { failOnStatusCode: false });
    expect(res.status(), `status of ${path}`).toBe(200);
    expect(res.headers()["content-type"], `content type of ${path}`).toContain(type);
  }
});

test("a reserved keyword still answers 200", async ({ request }) => {
  // The 404 above is decided one line below the RESERVED_SLUGS check, so the
  // way to get it wrong is to 404 the app's own routes.
  for (const path of ["/", "/privacy", "/qr-code-generator", "/pricing", "/dashboard"]) {
    const res = await request.get(path, { failOnStatusCode: false });
    expect(res.status(), `status of ${path}`).toBe(200);
  }
});

test("pricing.md serves as plain text for agents, not the app shell", async ({ request }) => {
  // Reaches the Worker through the same door as any dead slug: one segment,
  // not a reserved keyword the /:slug guard already skips (see llms.txt's
  // entry above). The point of the test is that it comes back as itself
  // rather than the SPA shell serveSpa falls back to.
  const res = await request.get("/pricing.md");

  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).not.toContain("html");

  const body = await res.text();
  expect(body).toContain("# rdyrct pricing");
  expect(body).toContain("Hobby: $4/month");
});

test("walking off a public page does not take its title along", async ({ page }) => {
  // The head the Worker wrote is right for the document it served, and wrong
  // for wherever a client-side navigation goes next. Restoring "what the
  // document arrived with" looked correct and was exactly backwards for the
  // visitor who arrived on the public page itself: they carried the privacy
  // title onto the page they clicked through to.
  await page.goto("/privacy");
  await expect(page).toHaveTitle(/Privacy policy/);

  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveTitle(/Terms of service/);

  // And off a public page entirely. Asserted as "not the page we left",
  // because what the landing page ends up titled depends on whether it
  // claims a head of its own, while "the privacy title came along" is the
  // bug in either case.
  await page.goto("/privacy");
  await page.getByRole("link", { name: "rdyrct" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).not.toHaveTitle(/Privacy policy/);
});
