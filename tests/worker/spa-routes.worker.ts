import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, fetchWorker, overrideEnv } from "./support";

/**
 * The SPA fallback serves the router's pages and 404s everything else
 * (src/shared/spa-routes.ts). Before, any path the Worker didn't own got the
 * shell under a 200 with the landing page's title and canonical: a soft 404
 * for every mistyped or invented address a crawler found.
 */

beforeEach(applyTestMigrations);
afterEach(reset);

const get = (path: string, method = "GET") =>
  fetchWorker(new Request(`http://localhost${path}`, { method, redirect: "manual" }));

describe("the SPA fallback", () => {
  it.each([
    "/",
    "/pricing",
    "/docs",
    "/report",
    "/login",
    "/signup?next=/billing",
    "/reset-password",
    "/consent",
    "/onboarding",
    "/invite/x",
    "/dashboard",
    "/analytics",
    "/links",
    "/links/abc",
    "/links/MixedCase",
    "/members",
    "/billing",
    "/domains",
    "/settings",
    "/api-keys",
    "/organization",
    "/admin",
    "/admin/links",
    "/admin/orgs",
    "/admin/users",
    "/admin/audit",
  ])("serves %s", async (path) => {
    const res = await get(path);

    expect(res.status).toBe(200);
  });

  it.each([
    "/some/deep/path",
    "/pricing/extra",
    "/links/abc/def",
    "/invite",
    "/admin/nope",
    "/dashboard/x",
    "/audit",
    "/app",
    "/blog/some-post",
    "/.well-known/security.txt",
  ])("answers %s with a 404 nothing caches", async (path) => {
    const res = await get(path);

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBeNull();
    // Still the SPA, which renders its NotFound page.
    expect(await res.text()).toContain('<div id="root">');
  });

  it("404s an unknown path whatever the method", async () => {
    expect((await get("/some/deep/path", "HEAD")).status).toBe(404);
    expect((await get("/some/deep/path", "POST")).status).toBe(404);
  });

  it.each([
    ["/PRICING", "/pricing"],
    ["/Dashboard", "/dashboard"],
    ["/ADMIN/Users", "/admin/users"],
    ["/Admin", "/admin"],
  ])("moves %s to %s", async (path, location) => {
    const res = await get(path);

    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`http://localhost${location}`);
  });

  it("lowercases the route but not the slug or token in it", async () => {
    const link = await get("/LINKS/AbC?tab=qr");
    const invite = await get("/Invite/TokEN");

    expect(link.status).toBe(301);
    expect(link.headers.get("location")).toBe("http://localhost/links/AbC?tab=qr");
    expect(invite.headers.get("location")).toBe("http://localhost/invite/TokEN");
  });

  it("keeps short links case-sensitive", async () => {
    await env.LINKS.put(
      "slug:AbC",
      JSON.stringify({ linkId: "link-1", orgId: "org-1", url: "https://example.com/" }),
    );

    expect((await get("/AbC")).status).toBe(302);
    expect((await get("/abc")).status).toBe(404);
  });

  it("does not redirect a write to a known page in the wrong case", async () => {
    // A 405 rather than a 404: GET /:slug exists, and the method-not-allowed
    // middleware turns the 404 into an answer naming it.
    expect((await get("/PRICING", "POST")).status).toBe(405);
  });

  it("passes a real file under an unknown path through untouched", async () => {
    // In dev the source modules come through this fallback, and in production
    // any root file not excluded from run_worker_first does: only the HTML
    // shell may turn into a 404.
    const script = "export {};";
    const assets: Fetcher = {
      fetch: async () => new Response(script, { headers: { "content-type": "text/javascript" } }),
      connect: () => {
        throw new Error("ASSETS.connect is not used");
      },
    };
    const res = await fetchWorker(
      new Request("http://localhost/src/app/main.tsx"),
      overrideEnv({ ASSETS: assets }),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(script);
  });
});
