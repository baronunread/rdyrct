import { expect, test } from "@playwright/test";

// Fetched, not rendered: Slack, WhatsApp, iMessage, Discord and Bing's first
// pass never run the page's JavaScript, so a title set on mount would pass a
// rendered check and be wrong for all of them.

const PAGES = [
  { path: "/", title: /URL shortener and QR code generator/ },
  { path: "/qr-code-generator", title: /QR code generator with logo/ },
  { path: "/utm-builder", title: /UTM builder/ },
  { path: "/branded-link-shortener", title: /Custom URL shortener/ },
  { path: "/pricing", title: /URL shortener and QR code generator pricing/ },
  { path: "/roadmap", title: /URL shortener roadmap/ },
  { path: "/changelog", title: /rdyrct changelog/ },
  { path: "/compare", title: /Compare rdyrct/ },
  { path: "/bitly-alternative", title: /Bitly alternative/ },
  { path: "/rebrandly-alternative", title: /Rebrandly alternative/ },
  { path: "/dub-alternative", title: /Dub alternative/ },
  { path: "/short-io-alternative", title: /Short\.io alternative/ },
  { path: "/google-url-shortener", title: /Google URL shortener/ },
  { path: "/whatsapp-qr-code", title: /WhatsApp QR code generator/ },
  { path: "/vcard-qr-code", title: /vCard QR code generator/ },
  { path: "/wifi-qr-code", title: /WiFi QR code generator/ },
  { path: "/qr-code-monkey-alternative", title: /QR Code Monkey alternative/ },
  { path: "/flowcode-alternative", title: /Flowcode alternative/ },
  { path: "/tinyurl-alternative", title: /TinyURL alternative/ },
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

test("a public page negotiates Markdown without changing the browser document", async ({
  request,
}) => {
  const markdown = await request.get("/pricing", {
    headers: { Accept: "text/markdown" },
  });
  expect(markdown.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  expect(markdown.headers()["vary"]).toContain("Accept");
  expect(markdown.headers()["link"]).toContain(
    `<${new URL(markdown.url()).origin}/pricing>; rel="canonical"`,
  );
  expect(await markdown.text()).toContain("# rdyrct pricing");

  const html = await request.get("/pricing", { headers: { Accept: "text/html" } });
  expect(html.headers()["content-type"]).toContain("text/html");
  expect(html.headers()["vary"]).toContain("Accept");
  expect(await html.text()).toMatch(/<div id="root"(?:\s|>)/);
});

test("the QR page describes itself in the share tags, not the landing page", async ({
  request,
}) => {
  const html = await (await request.get("/qr-code-generator")).text();

  expect(html).toMatch(/"og:title" content="QR code generator/);
  expect(html).toMatch(/"og:description" content="Make a custom QR code for free/);
  expect(html).toMatch(/"og:url" content="[^"]*\/qr-code-generator"/);
});

test("the signed-in app keeps the default head", async ({ request }) => {
  const html = await (await request.get("/dashboard")).text();

  expect(html).toContain("<title>rdyrct - URL shortener and QR code generator</title>");
});

test("the QR generator exposes its instructions and print guides without JavaScript", async ({
  request,
  browser,
}) => {
  const response = await request.get("/qr-code-generator");
  expect(response.status()).toBe(200);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(response.url());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("QR code generator with logo");
    await expect(page.getByRole("heading", { name: "How to make a QR code" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "QR code questions" })).toBeVisible();
    for (const path of ["qr-code-logo", "qr-code-size", "qr-code-testing"]) {
      await expect(page.locator(`main a[href="/blog/${path}"]`)).toBeVisible();
    }
  } finally {
    await context.close();
  }
});

test("robots.txt declares both sitemaps", async ({ request }) => {
  // The blog is a separate Worker with its own sitemap at /blog/sitemap.xml.
  const robots = await (await request.get("/robots.txt")).text();

  expect(robots).toContain("Sitemap: https://rdyrct.com/sitemap.xml");
  expect(robots).toContain("Sitemap: https://rdyrct.com/blog/sitemap.xml");
});

// Live robots.txt merges Cloudflare's managed block (content signals, AI
// crawlers) with the origin's. This preview sees the origin half only; the
// managed half is a dashboard switch with nothing in git.
test("robots.txt blocks the API and lets crawlers read the app pages' noindex", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /api/");

  // Disallow stops fetching, not listing, and hides the noindex from the crawler.
  for (const path of ["/dashboard", "/api-keys", "/links", "/admin", "/invite/"]) {
    expect(robots).not.toContain(`Disallow: ${path}`);
  }
  for (const path of [
    "/dashboard",
    "/api-keys",
    "/links/some-slug",
    "/invite/abc",
    "/login",
    "/report",
  ]) {
    const res = await request.get(path);
    expect(res.headers()["x-robots-tag"], path).toBe("noindex");
  }
  for (const path of ["/", "/pricing", "/signup"]) {
    const res = await request.get(path);
    expect(res.headers()["x-robots-tag"], path).toBeUndefined();
  }
});

test("the shared structured data has no app node Google would reject", async ({ request }) => {
  // Google fails a SoftwareApplication with no rating or review (Ahrefs, 2026-11).
  const html = await (await request.get("/pricing")).text();
  expect(html).toContain('"@type": "Organization"');
  expect(html).not.toContain('"@type": "SoftwareApplication"');
});

test("a slug that resolves to nothing answers 404", async ({ request }) => {
  // Under a 200 this is a soft 404: the shell's canonical is the landing page.
  const res = await request.get("/no-such-slug-9f3a2", { failOnStatusCode: false });

  expect(res.status()).toBe(404);
  expect(await res.text()).toMatch(/<div id="root"(?:\s|>)/);
});

test("the second visit to a dead slug still renders the page", async ({ request }) => {
  // Regression: the 404 carried the shell's ETag and must-revalidate, so the
  // browser got a bodiless 304 on the second visit: a blank page.
  const first = await request.get("/no-such-slug-7d2e1", { failOnStatusCode: false });
  expect(first.status()).toBe(404);
  expect((await first.body()).length, "the 404 should carry the page").toBeGreaterThan(0);

  expect(first.headers()["cache-control"]).toBe("no-store");
  expect(first.headers()["etag"]).toBeUndefined();

  const second = await request.get("/no-such-slug-7d2e1", {
    headers: { "If-None-Match": '"whatever-it-had-before"' },
    failOnStatusCode: false,
  });
  expect((await second.body()).length, "a conditional request must not empty it").toBeGreaterThan(
    0,
  );
});

test("a file the bundle serves at the root still answers 200", async ({ request }) => {
  // run_worker_first excludes these by a hand-written list, and a dropped name fell through
  // the slug handler (the favicon once did). The content type matters: a status-only check
  // would pass when the SPA shell answers /og.png.
  const assets = [
    ["/favicon.svg", "image/svg+xml"],
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
  for (const path of ["/", "/privacy", "/qr-code-generator", "/pricing", "/dashboard"]) {
    const res = await request.get(path, { failOnStatusCode: false });
    expect(res.status(), `status of ${path}`).toBe(200);
  }
});

test("pricing.md serves as plain text for agents, not the app shell", async ({ request }) => {
  const res = await request.get("/pricing.md");

  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).not.toContain("html");

  const body = await res.text();
  expect(body).toContain("# rdyrct pricing");
  expect(body).toContain("Hobby: $4/month");
});

test("walking off a public page does not take its title along", async ({ page }) => {
  // The head the Worker wrote is wrong for the next client-side page. Restoring
  // the arrival head was backwards for visitors who arrived on the public page.
  await page.goto("/privacy");
  await expect(page).toHaveTitle(/Privacy policy/);

  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveTitle(/Terms of service/);

  // Asserted as "not the page we left": the landing title depends on whether it
  // claims its own head, while the privacy title carrying over is the bug.
  await page.goto("/privacy");
  await page.getByRole("link", { name: "rdyrct" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).not.toHaveTitle(/Privacy policy/);
});

// X does not reliably fall back to og:image once twitter:card is set, nor for alt.
test("the share tags carry an image for both card formats", async ({ request }) => {
  const html = await (await request.get("/")).text();

  for (const tag of ["og:image", "twitter:image"]) {
    const attr = tag.startsWith("og:") ? "property" : "name";
    const found = new RegExp(`${attr}="${tag}" content="([^"]*)"`).exec(html)?.[1] ?? "";
    expect(found, tag).toMatch(/^https:\/\/rdyrct\.com\/og\.png$/);
  }
});

// Without JavaScript a crawler sees only index.html's static block, once 289
// words: too few to match queries or be cited. This guards length, not wording.
test("the no-JavaScript HTML says enough to be worth indexing", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const body = html.slice(html.indexOf("<body"));
  const text = body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

  expect(text.split(/\s+/).filter(Boolean).length).toBeGreaterThan(600);
});
