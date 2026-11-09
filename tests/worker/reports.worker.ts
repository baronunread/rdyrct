import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  authEnv,
  captureEmails,
  fetchWorker,
  overrideEnv,
  rawAddressRow,
  rawLinkRow,
  seedLink,
  testDb,
} from "./support";
import * as schema from "../../src/worker/db/schema";
import {
  parseReportedLink,
  REPORT_NOTICE_WINDOW_MS,
  REPORTS_TO_FLAG,
  sweepReportNotices,
} from "../../src/worker/routes/reports";

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

describe("the admin's report mail", () => {
  const ADMIN = "admin@example.com";
  const mailEnv = () => overrideEnv({ ...authEnv(), SUPERADMIN_EMAIL: ADMIN });
  const reportFrom = (link: string, ip: string) =>
    fetchWorker(
      new Request("http://localhost/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ link, reason: "spam" }),
      }),
      mailEnv(),
    );

  async function seedLinks(n: number) {
    const db = testDb();
    await db.insert(schema.orgs).values({ id: "org-1", name: "Test", createdAt: 0 });
    for (let i = 0; i < n; i++) {
      await db.insert(schema.links).values(
        rawLinkRow({
          id: `l${i}`,
          orgId: "org-1",
          slug: `s${i}`,
          destination: "https://example.com",
          createdAt: 0,
        }),
      );
      await db.insert(schema.linkAddresses).values(
        rawAddressRow({
          id: `a${i}`,
          linkId: `l${i}`,
          orgId: "org-1",
          slug: `s${i}`,
          kind: "primary",
          createdAt: 0,
        }),
      );
    }
  }

  const toAdmin = (sent: { to: string }[]) => sent.filter((m) => m.to === ADMIN).length;

  it("sends at most one per window however many links are reported, and keeps every report", async () => {
    await seedLinks(50);
    const mail = captureEmails();
    try {
      for (let i = 0; i < 50; i++)
        expect((await reportFrom(`s${i}`, `192.0.2.${i}`)).status).toBe(201);
      expect(toAdmin(mail.sent)).toBe(1);
      const rows = await env.DB.prepare(
        "select count(*) as n from link_reports where link_id is not null",
      ).first<{ n: number }>();
      expect(rows?.n).toBe(50);

      // A made-up slug costs no mail.
      await reportFrom("nope1234", "192.0.2.200");
      expect(toAdmin(mail.sent)).toBe(1);
    } finally {
      mail.restore();
    }
  });

  it("tells the admin about reports that came in during the quiet window, once it ends", async () => {
    await seedLinks(3);
    const mail = captureEmails();
    try {
      await reportFrom("s0", "192.0.2.1");
      await reportFrom("s1", "192.0.2.2");
      expect(toAdmin(mail.sent)).toBe(1);

      // Still inside the window: the sweep sends nothing.
      await sweepReportNotices(mailEnv());
      expect(toAdmin(mail.sent)).toBe(1);

      // The window passes: the report on s1 is told in one digest, once.
      await env.DB.prepare("update link_reports set notified_at = notified_at - ?")
        .bind(REPORT_NOTICE_WINDOW_MS + 1)
        .run();
      await sweepReportNotices(mailEnv());
      await sweepReportNotices(mailEnv());
      expect(toAdmin(mail.sent)).toBe(2);

      // And a quiet link reported after the next window still mails at once.
      await env.DB.prepare("update link_reports set notified_at = notified_at - ?")
        .bind(REPORT_NOTICE_WINDOW_MS + 1)
        .run();
      await reportFrom("s2", "192.0.2.3");
      expect(toAdmin(mail.sent)).toBe(3);
    } finally {
      mail.restore();
    }
  });
});
