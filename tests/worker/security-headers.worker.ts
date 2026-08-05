import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import type { Env } from "../../src/worker/env";
import { applyTestMigrations, overrideEnv } from "./support";

async function fetchWorker(request: Request, testEnv: Env = env as Env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

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

  it("never overrides headers on the reverse-proxied blog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );
    const testEnv = overrideEnv({ BLOG_ORIGIN_URL: "https://rdyrct-blog.vercel.app" });

    const res = await fetchWorker(new Request("http://localhost/blog/hello-world"), testEnv);

    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
