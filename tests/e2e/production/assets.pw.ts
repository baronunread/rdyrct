import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * How the built bundle is cached, and what happens to a chunk that is gone.
 *
 * /assets/* is excluded from run_worker_first (wrangler.jsonc): Cloudflare
 * serves it directly, the Worker never runs, and public/_headers is what
 * sets Cache-Control and the security-header baseline instead of
 * applySecurityHeaders/serveSpa (src/worker/index.ts).
 *
 * `_headers` matches on the path pattern, not on whether a file actually
 * exists there, so a request for a chunk deleted by a later deploy gets the
 * SPA shell (not_found_handling) cached the same as a real file. That's why
 * the max-age below is a day with must-revalidate, not the year a content
 * hash would otherwise justify: it bounds how long that wrong response can
 * survive instead of pinning it until someone notices.
 *
 * This runs against `vite preview`, the built Worker and the real bundle.
 * `vite dev` serves neither, and the worker tests stub ASSETS, so this is the
 * only place any of it is real.
 */

/**
 * A hashed chunk from the built bundle, read off the page that loads it
 * rather than off disk: the hash changes every build, and a test that knows a
 * filename is a test that fails on the next one.
 */
async function bundledScript(request: APIRequestContext): Promise<string> {
  const html = await (await request.get("/")).text();
  const src = /\/assets\/[A-Za-z0-9_.-]+\.js/.exec(html)?.[0];
  if (!src) throw new Error("the landing page loaded no hashed chunk");
  return src;
}

test("a hashed chunk is cached for a day and immutable within it", async ({ request }) => {
  // Served as `max-age=0, must-revalidate` (the default) the browser asked
  // again for every chunk on every page load, and every one of those was a
  // request for a file that could not have changed.
  const res = await request.get(await bundledScript(request));

  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("public, max-age=86400, immutable, must-revalidate");
});

test("a hashed chunk carries the security-header baseline", async ({ request }) => {
  // Set by public/_headers now, not applySecurityHeaders: the Worker never
  // sees this request. If the CSP disappears here, something started
  // serving /assets/ without _headers applied at all.
  const res = await request.get(await bundledScript(request));

  expect(res.headers()["content-security-policy"]).toBeTruthy();
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a chunk that no longer exists is served as the SPA shell, boundedly cached", async ({
  request,
}) => {
  // What a browser on a stale index.html asks for after a deploy. Cloudflare
  // answers the unmatched path with the SPA shell under a 200
  // (not_found_handling) before the Worker ever sees it, and _headers can't
  // tell that apart from a real file, so this gets cached too — for a day,
  // not a year, and must-revalidate stops it from serving stale past that.
  const res = await request.get("/assets/does-not-exist-4b1c8.js", {
    failOnStatusCode: false,
  });

  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");
  expect(res.headers()["cache-control"]).toBe("public, max-age=86400, immutable, must-revalidate");
});

test("every file under /assets/ is content-hashed", async ({ request }) => {
  // The year-long cache is only safe because these names change with their
  // contents. Nothing enforces that but Vite's default: an `assetFileNames`
  // override, or one fixed-name file copied into the directory, and that file
  // is pinned in browsers for a year with no way to correct it. So assert the
  // invariant rather than the habit.
  const html = await (await request.get("/")).text();
  const names = [...html.matchAll(/\/assets\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
  expect(names.length, "the landing page should reference some assets").toBeGreaterThan(0);

  for (const name of new Set(names)) {
    expect(name, `${name} carries no content hash`).toMatch(/-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/);
  }
});
