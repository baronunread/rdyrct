import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * How the built bundle is cached, and what happens to a chunk that is gone.
 *
 * Every filename under /assets/ carries a content hash, so those URLs cannot
 * change meaning and public/_headers caches them for a year. The Worker still
 * runs in front of them (run_worker_first stays true, see wrangler.jsonc):
 * `_headers` applies to what the Worker serves through the ASSETS binding
 * too, so the caching costs nothing that the Worker was doing.
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

test("a hashed chunk is cached for a year and never revalidated", async ({ request }) => {
  // Served as `max-age=0, must-revalidate` (the default) the browser asked
  // again for every chunk on every page load, and every one of those was a
  // request for a file that could not have changed.
  const res = await request.get(await bundledScript(request));

  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
});

test("a hashed chunk keeps the headers the Worker adds", async ({ request }) => {
  // The caching above does not come at the price of the Worker in front of
  // it. If the CSP disappears here, something started serving /assets/
  // without it, and the missing-chunk guard below stopped running too.
  const res = await request.get(await bundledScript(request));

  expect(res.headers()["content-security-policy"]).toBeTruthy();
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a chunk that no longer exists 404s instead of being cached as a page", async ({
  request,
}) => {
  // What a browser on a stale index.html asks for after a deploy. The asset
  // binding answers an unmatched path with the SPA shell under a 200
  // (not_found_handling), and /assets/* is marked immutable for a year, so
  // without the guard in serveSpa this would pin an HTML document to the URL
  // in a cache nothing can reach.
  const res = await request.get("/assets/does-not-exist-4b1c8.js", {
    failOnStatusCode: false,
  });

  expect(res.status()).toBe(404);
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(res.headers()["content-type"] ?? "").not.toContain("text/html");
});

test("the _headers file is configuration, not content", async ({ request }) => {
  const res = await request.get("/_headers", { failOnStatusCode: false });

  expect(res.status()).not.toBe(200);
});
