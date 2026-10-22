import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { RDYRCT_SITE } from "../../src/shared/site";
import { applySecurityHeaders } from "../../src/worker/security-headers";
import { markdownPage, withPageMeta } from "../../src/worker/page-meta";
import { applyTestMigrations, fetchWorker } from "./support";

/**
 * A self-hosted build: the Worker a fork deploys, which serves the app and
 * short links and none of rdyrct.com's own pages.
 *
 * It only runs as `bun run test:worker:self-host` (VITE_RDYRCT_SITE=0, see
 * vitest.config.ts). Every other worker test runs as rdyrct.com, where this
 * file has nothing to check.
 */

beforeEach(applyTestMigrations);
afterEach(reset);

describe.runIf(!RDYRCT_SITE)("a self-hosted build", () => {
  it("opens on the app, not a landing page", async () => {
    const res = await fetchWorker(new Request("http://localhost/"));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
  });

  it.each(["/pricing", "/docs", "/privacy", "/terms", "/report", "/bitly-alternative"])(
    "answers rdyrct.com's %s with a 404",
    async (path) => {
      const res = await fetchWorker(new Request(`http://localhost${path}`));

      expect(res.status).toBe(404);
    },
  );

  it("moves no wrong-case address to rdyrct.com's pages", async () => {
    const res = await fetchWorker(new Request("http://localhost/PRICING", { redirect: "manual" }));

    expect(res.status).toBe(404);
  });

  it.each(["/dashboard", "/links/abc", "/invite/x", "/admin/users"])(
    "still serves the app's %s",
    async (path) => {
      const res = await fetchWorker(new Request(`http://localhost${path}`));

      expect(res.status).toBe(200);
    },
  );

  it("has no Markdown pricing page", async () => {
    const res = await fetchWorker(new Request("http://localhost/pricing.md"));

    expect(res.status).toBe(404);
  });

  it("takes no links from strangers", async () => {
    const res = await fetchWorker(
      new Request("http://localhost/api/shorten", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it("describes no page as rdyrct.com's", async () => {
    const url = new URL("https://links.example.com/pricing");
    const shell = new Response("<html><head><title>app</title></head><body></body></html>", {
      headers: { "content-type": "text/html" },
    });

    expect(await withPageMeta(shell, url).text()).toContain("<title>app</title>");
    expect(markdownPage(url, "text/markdown")).toBeNull();
  });

  it("allows no rdyrct.com analytics script", () => {
    const csp = applySecurityHeaders(new Response("ok")).headers.get("content-security-policy");

    expect(csp).not.toContain("stats.brnr.dev");
  });
});
