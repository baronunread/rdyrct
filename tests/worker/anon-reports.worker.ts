import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  adminCookie,
  applyTestMigrations,
  authEnv,
  captureEmails,
  fetchWorker,
  jsonBody,
  overrideEnv,
} from "./support";
import {
  REPORT_NOTICE_WINDOW_MS,
  REPORTERS_TO_WARN,
  sweepReportNotices,
} from "../../src/worker/routes/reports";
import { publishAnonLink } from "../../src/worker/kv";
import type { AdminReportRow } from "../../src/shared/types";

/**
 * Reports about anonymous links from the landing page (#488). They used to
 * match nothing: the lookup only read link_addresses, so the report kept no
 * link, mailed nobody and warned nothing. An anonymous link now gets a free
 * org's link's rules, less the org flag it has no org for.
 */

const HOUR = 60 * 60 * 1000;
const ADMIN = "admin@example.com";
const mailEnv = () => overrideEnv({ ...authEnv(), SUPERADMIN_EMAIL: ADMIN });

async function seedAnon(id = "anon-1", slug = "anon123", expiresAt = Date.now() + 24 * HOUR) {
  const row = { id, slug, destination: "https://example.com/anon", expiresAt };
  await env.DB.prepare(
    `insert into anon_links (id, slug, destination, claim_token, created_at, expires_at)
     values (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, slug, row.destination, `tok-${id}`, Date.now(), expiresAt)
    .run();
  await publishAnonLink(env, { ...row, warned: false });
}

// Each call comes from a new address unless told otherwise: the warning
// counts distinct reporters, not reports.
let reporters = 0;
const report = (link = "anon123", ip = `198.51.100.${++reporters}`) =>
  fetchWorker(
    new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ link, reason: "phishing" }),
    }),
    mailEnv(),
  );

const reportRows = async () =>
  (
    await env.DB.prepare(
      "select anon_link_id, link_id, org_id from link_reports order by created_at",
    ).all<{ anon_link_id: string | null; link_id: string | null; org_id: string | null }>()
  ).results;

const kvValue = (slug = "anon123") => env.LINKS.get(`slug:${slug}`, "json");

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

describe("a report about an anonymous link", () => {
  it("names the link, from a bare slug and from a full shared-host URL", async () => {
    await seedAnon();
    expect((await report()).status).toBe(201);
    expect((await report(`https://${env.SHARED_LINK_HOST}/anon123`)).status).toBe(201);
    expect(await reportRows()).toEqual([
      { anon_link_id: "anon-1", link_id: null, org_id: null },
      { anon_link_id: "anon-1", link_id: null, org_id: null },
    ]);
  });

  it("matches nothing once the link has expired, or on a custom domain", async () => {
    await seedAnon("anon-old", "old123", Date.now() - 1);
    await seedAnon("anon-live", "live123");
    await report("old123");
    await report("https://go.example.com/live123");
    expect((await reportRows()).map((r) => r.anon_link_id)).toEqual([null, null]);
  });

  it("mails the admin on the first report, as a link's does", async () => {
    await seedAnon();
    const mail = captureEmails();
    try {
      await report();
      expect(mail.sent.filter((m) => m.to === ADMIN)).toHaveLength(1);
    } finally {
      mail.restore();
    }
  });

  it("is told in the next digest when it came in during the quiet window", async () => {
    await seedAnon();
    // Another report already took this hour's mail.
    await env.DB.prepare(
      "insert into link_reports (id, slug, reason, created_at, notified_at) values ('r0', 'x', 'spam', 0, ?)",
    )
      .bind(Date.now())
      .run();
    const mail = captureEmails();
    try {
      await report();
      expect(mail.sent.filter((m) => m.to === ADMIN)).toHaveLength(0);
      await env.DB.prepare("update link_reports set notified_at = notified_at - ?")
        .bind(REPORT_NOTICE_WINDOW_MS + 1)
        .run();
      expect(await sweepReportNotices(mailEnv())).toBe(true);
      expect(mail.sent.filter((m) => m.to === ADMIN)).toHaveLength(1);
    } finally {
      mail.restore();
    }
  });

  it("puts the warning page in front at the threshold of different reporters", async () => {
    await seedAnon();
    // One reporter twice is still one reporter.
    await report("anon123", "203.0.113.9");
    await report("anon123", "203.0.113.9");
    expect(await kvValue()).not.toHaveProperty("warn");

    for (let i = 0; i < REPORTERS_TO_WARN; i++) await report();
    expect(await kvValue()).toMatchObject({ warn: true, orgId: "", linkId: "anon-1" });
    // The redirect path shows the warning page instead of redirecting.
    const visit = await fetchWorker(
      new Request("http://localhost/anon123", { redirect: "manual" }),
    );
    expect(visit.status).toBe(200);
    expect(await visit.text()).toContain("Check where this link goes.");
  });

  it("counts reporters per link, so reports on two links do not add up", async () => {
    await seedAnon();
    await seedAnon("anon-2", "other12");
    for (let i = 0; i < REPORTERS_TO_WARN - 1; i++) await report("anon123");
    for (let i = 0; i < REPORTERS_TO_WARN - 1; i++) await report("other12");
    expect(await kvValue()).not.toHaveProperty("warn");
    expect(await kvValue("other12")).not.toHaveProperty("warn");
  });

  it("shows in the admin's reports as anonymous, with no org", async () => {
    await seedAnon();
    await report();
    const rows = await jsonBody<AdminReportRow[]>(
      await fetchWorker(
        new Request("http://localhost/api/admin/links/reports", {
          headers: { cookie: await adminCookie() },
        }),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ anonymous: true, orgId: null, linkId: null });
  });

  it("leaves a report about a made-up slug unmatched, as before", async () => {
    await report("nosuchslug");
    expect(await reportRows()).toEqual([{ anon_link_id: null, link_id: null, org_id: null }]);
  });
});
