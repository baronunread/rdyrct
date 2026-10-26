import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, fetchWorker, seedLink } from "./support";
import { parseReportedLink, REPORTS_TO_FLAG } from "../../src/worker/routes/reports";

/**
 * The public report form. The browser test covers sending one (it runs Turnstile);
 * these cover what it does with the answer: stored whether or not the slug
 * exists, and flagging the org only at the threshold, never suspending.
 */

const report = (link: string, extra: Record<string, string> = {}) =>
  fetchWorker(
    new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ link, reason: "phishing", ...extra }),
    }),
  );

const flaggedAt = async () =>
  (
    await env.DB.prepare("select review_flagged_at as at from orgs where id = 'org-1'").first<{
      at: number | null;
    }>()
  )?.at ?? null;

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

describe("parseReportedLink", () => {
  it("reads a bare slug, a full URL, and a custom-domain URL", () => {
    expect(parseReportedLink("sale")).toEqual({ slug: "sale", host: null });
    expect(parseReportedLink("https://rdyr.cc/sale")).toEqual({ slug: "sale", host: "rdyr.cc" });
    expect(parseReportedLink("go.example.com/sale?x=1")).toEqual({
      slug: "sale",
      host: "go.example.com",
    });
    expect(parseReportedLink("https://rdyr.cc/")).toBeNull();
    // Dev and self-hosted app hosts carry a port.
    expect(parseReportedLink("localhost:5174/sale")).toEqual({
      slug: "sale",
      host: "localhost:5174",
    });
  });
});

describe("POST /api/reports", () => {
  it("answers the same for a real link and a made-up one", async () => {
    await seedLink();
    const real = await report("sale");
    const fake = await report("nope1234");
    expect(real.status).toBe(201);
    expect(fake.status).toBe(201);
    expect(await real.json()).toEqual(await fake.json());
    const rows = await env.DB.prepare("select slug, link_id from link_reports order by slug").all<{
      slug: string;
      link_id: string | null;
    }>();
    expect(rows.results).toEqual([
      { slug: "nope1234", link_id: null },
      { slug: "sale", link_id: "link-1" },
    ]);
  });

  it("matches a full URL on the app host, where shared-domain links also answer", async () => {
    await seedLink();
    await report(`https://${env.APP_HOST}/sale`);
    const row = await env.DB.prepare("select link_id from link_reports").first<{
      link_id: string | null;
    }>();
    expect(row?.link_id).toBe("link-1");
  });

  it("flags the org at the threshold and never suspends the link", async () => {
    await seedLink();
    for (let i = 0; i < REPORTS_TO_FLAG - 1; i++) await report("sale");
    expect(await flaggedAt()).toBeNull();

    await report("sale");
    expect(await flaggedAt()).not.toBeNull();
    const link = await env.DB.prepare(
      "select suspended_at as at from links where id = 'link-1'",
    ).first<{ at: number | null }>();
    expect(link?.at).toBeNull();
  });

  it("rejects an unknown reason and an empty link", async () => {
    expect((await report("sale", { reason: "boredom" })).status).toBe(400);
    expect((await report("   ")).status).toBe(400);
  });
});
