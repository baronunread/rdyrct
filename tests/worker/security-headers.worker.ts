import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applySecurityHeaders } from "../../src/worker/security-headers";
import { applyTestMigrations, fetchWorker, overrideEnv } from "./support";

const HEADER_NAMES = [
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

function expectSecurityHeaders(res: Response) {
  for (const name of HEADER_NAMES) expect(res.headers.get(name)).toBeTruthy();
  expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
}

beforeEach(applyTestMigrations);
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

describe("security headers (#21)", () => {
  it("applies to a successful redirect", async () => {
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values (?, ?, ?)").bind(
        "org-1",
        "Test org",
        0,
      ),
      env.DB.prepare(
        "insert into links (id, org_id, slug, destination, created_at) values (?, ?, ?, ?, ?)",
      ).bind("link-1", "org-1", "summer", "https://example.com/sale", 0),
    ]);
    await env.LINKS.put(
      "slug:summer",
      JSON.stringify({ linkId: "link-1", orgId: "org-1", url: "https://example.com/sale" }),
    );

    const res = await fetchWorker(new Request("http://localhost/summer", { redirect: "manual" }));
    expect(res.status).toBe(302);
    expectSecurityHeaders(res);
  });

  it("applies to an HTTPException error response", async () => {
    const res = await fetchWorker(new Request("http://localhost/api/billing/portal"));
    expect(res.status).toBe(401); // requireUser, no session cookie
    expectSecurityHeaders(res);
  });

  it("applies to a 404 SPA fallback response", async () => {
    const res = await fetchWorker(new Request("http://localhost/no-such-page"));
    expectSecurityHeaders(res);
  });

  // Regression: applySecurityHeaders used to write straight onto the
  // response it was handed, which throws "Can't modify immutable headers"
  // for anything the ASSETS binding returns (every static file, so the whole
  // SPA) and for Response.redirect.
  //
  // The SPA-fallback test above cannot catch this: there is no built asset
  // bundle in this environment, so app.all("*") never reaches a real
  // env.ASSETS.fetch response and the fallback it does return has mutable
  // headers. Only the e2e smoke test exercises the real binding, which is
  // where this first showed up. Response.redirect gives us the same
  // immutable Headers guard here, deterministically and with no bundle.
  it("works on a response whose headers are immutable", () => {
    const immutable = Response.redirect("https://example.com/", 302);
    expect(() => immutable.headers.set("x-probe", "1")).toThrow();

    const res = applySecurityHeaders(immutable);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/");
    expectSecurityHeaders(res);
  });

  it("never overrides headers on the reverse-proxied blog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );
    const testEnv = overrideEnv({ BLOG_ORIGIN_URL: "https://rdyrct-blog.vercel.app" });

    const res = await fetchWorker(new Request("http://localhost/blog/hello-world"), testEnv);

    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
