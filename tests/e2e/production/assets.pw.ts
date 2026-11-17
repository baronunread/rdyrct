import { expect, test, type APIRequestContext } from "@playwright/test";

// /assets/* skips the Worker, so public/_headers sets its headers. It matches
// paths, not files: a deleted chunk gets the SPA shell cached like a real one,
// so max-age is a day with must-revalidate, not a year.

async function bundledScript(request: APIRequestContext): Promise<string> {
  const html = await (await request.get("/")).text();
  const src = /\/assets\/[A-Za-z0-9_.-]+\.js/.exec(html)?.[0];
  if (!src) throw new Error("the landing page loaded no hashed chunk");
  return src;
}

test("source maps are not public assets", async ({ request }) => {
  const script = await bundledScript(request);
  const response = await request.get(`${script}.map`);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(await response.text()).not.toContain('"sourcesContent"');
});

test("a hashed chunk is cached for a day and immutable within it", async ({ request }) => {
  const res = await request.get(await bundledScript(request));

  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("public, max-age=86400, immutable, must-revalidate");
});

test("a hashed chunk carries the security-header baseline", async ({ request }) => {
  // public/_headers sets this, the Worker never sees the request. A missing CSP
  // means /assets/ is served without _headers.
  const res = await request.get(await bundledScript(request));

  expect(res.headers()["content-security-policy"]).toBeTruthy();
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a chunk that no longer exists is served as the SPA shell, boundedly cached", async ({
  request,
}) => {
  // A stale index.html asks for a gone chunk; Cloudflare answers the SPA shell
  // under 200 before the Worker runs, and _headers caches it like a real file:
  // a day, not a year, with must-revalidate.
  const res = await request.get("/assets/does-not-exist-4b1c8.js", {
    failOnStatusCode: false,
  });

  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");
  expect(res.headers()["cache-control"]).toBe("public, max-age=86400, immutable, must-revalidate");
});

test("every file under /assets/ is content-hashed", async ({ request }) => {
  // The year-long cache is safe only because names change with contents, and
  // only Vite's default guarantees that: an assetFileNames override or a
  // fixed-name file would be pinned for a year.
  const html = await (await request.get("/")).text();
  const names = [...html.matchAll(/\/assets\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
  expect(names.length, "the landing page should reference some assets").toBeGreaterThan(0);

  for (const name of new Set(names)) {
    expect(name, `${name} carries no content hash`).toMatch(/-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/);
  }
});

// These unhashed root files used to go through the Worker, so _headers missed
// them and each visit paid a conditional request per file. They now skip
// run_worker_first and public/_headers names each one.
test("the unhashed static files at the root are cached for an hour", async ({ request }) => {
  for (const path of ["/og.png", "/favicon.svg", "/llms.txt", "/robots.txt"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["cache-control"], path).toBe("public, max-age=3600, must-revalidate");
  }
});

// The shell is the one thing here that must not be cached: page-meta.ts
// rewrites its head per path, so a cached copy would describe the wrong page.
test("the HTML shell stays uncached", async ({ request }) => {
  const res = await request.get("/pricing");

  expect(res.headers()["content-type"]).toContain("text/html");
  expect(res.headers()["cache-control"]).not.toContain("max-age=3600");
});
