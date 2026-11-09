/**
 * CSV export of an org's links (#75): every link, quoted and guarded, read
 * from D1 a batch at a time, and in a shape the import reads back.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, fetchWorker, freeOwnerCookie, rawLinkRow, testDb } from "./support";
import * as schema from "../../src/worker/db/schema";
import { EXPORT_BATCH, EXPORT_HEADER } from "../../src/worker/routes/link-export";
import { detectColumns, parseCsv, readRows } from "../../src/shared/link-import";

const HOST = "short.example";
let cookie: string;

beforeEach(async () => {
  await applyTestMigrations();
  cookie = await freeOwnerCookie({ id: "dom-1", hostname: HOST });
});

afterEach(reset);

const exportCsv = (headers: Record<string, string> = { cookie }) =>
  fetchWorker(new Request("http://localhost/api/orgs/org-1/link-export", { headers }));

/** D1 binds at most 100 parameters a statement, and a link row takes 18. */
async function insertLinks(links: (typeof schema.links.$inferInsert)[]) {
  const db = testDb();
  const statements = [];
  for (let i = 0; i < links.length; i += 5)
    statements.push(db.insert(schema.links).values(links.slice(i, i + 5)));
  const [first, ...rest] = statements;
  await db.batch([first, ...rest]);
}

async function rows(): Promise<string[][]> {
  const res = await exportCsv();
  expect(res.status).toBe(200);
  return parseCsv(await res.text());
}

describe("GET /api/orgs/:orgId/link-export", () => {
  it("refuses anyone who is not a member of the org", async () => {
    expect((await exportCsv({})).status).toBe(401);
    await env.DB.prepare("delete from org_members where user_id = 'free-1'").run();
    expect((await exportCsv()).status).toBe(403);
  });

  it("names the file after the org and the day", async () => {
    await env.DB.prepare("update orgs set name = 'Acme, Inc.' where id = 'org-1'").run();
    const res = await exportCsv();
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="rdyrct-links-acme-inc-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
  });

  it("writes one row per link, with UTMs back on the destination and clicks", async () => {
    const db = testDb();
    await db.insert(schema.links).values(
      rawLinkRow({
        id: "link-1",
        orgId: "org-1",
        domainId: "dom-1",
        slug: "spring",
        destination: "https://example.com/sale",
        title: "Spring sale",
        utmSource: "news",
        createdAt: Date.UTC(2026, 0, 2),
      }),
    );
    await db.insert(schema.linkAddresses).values([
      {
        id: "a-1",
        linkId: "link-1",
        orgId: "org-1",
        domainId: "dom-1",
        slug: "spring",
        kind: "primary",
        createdAt: 0,
      },
      {
        id: "a-2",
        linkId: "link-1",
        orgId: "org-1",
        domainId: "dom-1",
        slug: "old",
        kind: "permanent_alias",
        createdAt: 0,
      },
    ]);
    await env.DB.prepare(
      "insert into click_daily (org_id, day, link_id, clicks) values ('org-1', '2026-01-02', 'link-1', 7), ('org-1', '2026-01-03', 'link-1', 5)",
    ).run();

    const [header, row, ...rest] = await rows();
    expect(header).toEqual(EXPORT_HEADER);
    expect(rest).toEqual([]);
    expect(row).toEqual([
      `https://${HOST}/spring`,
      "https://example.com/sale?utm_source=news",
      "Spring sale",
      `https://${HOST}/old`,
      "2026-01-02T00:00:00.000Z",
      "12",
    ]);
  });

  it("quotes commas, quotes and line breaks, and defuses formulas", async () => {
    const titles = ['Sale, "big" one', "two\nlines", "=HYPERLINK(1)", "+1", "-1", "@SUM(A1)"];
    await insertLinks(
      titles.map((title, i) =>
        rawLinkRow({
          id: `link-${i}`,
          orgId: "org-1",
          slug: `s${i}`,
          destination: "https://example.com",
          title,
          createdAt: i,
        }),
      ),
    );
    const res = await exportCsv();
    const text = await res.text();
    expect(text).toContain('"Sale, ""big"" one"');
    expect(text).toContain('"two\nlines"');
    expect(text).toContain(",'=HYPERLINK(1),");
    expect(text).not.toMatch(/,[=+\-@]/);
    expect(parseCsv(text).map((cells) => cells[2])).toEqual([
      "Title",
      'Sale, "big" one',
      "two\nlines",
      "'=HYPERLINK(1)",
      "'+1",
      "'-1",
      "'@SUM(A1)",
    ]);
  });

  it("pages through more than one batch, every link once, in creation order", async () => {
    const total = EXPORT_BATCH * 2 + 3;
    // Two links share each created_at, and a pair straddles each batch
    // boundary, so the cursor has to break ties on id.
    const links = Array.from({ length: total }, (_, i) =>
      rawLinkRow({
        id: `link-${String(i).padStart(4, "0")}`,
        orgId: "org-1",
        slug: `s${i}`,
        destination: `https://example.com/${i}`,
        createdAt: Math.floor((i + 1) / 2),
      }),
    );
    await insertLinks(links);

    const [, ...body] = await rows();
    expect(body.map((cells) => cells[1])).toEqual(links.map((link) => link.destination));
  });

  it("reads back through the import", async () => {
    await testDb()
      .insert(schema.links)
      .values(
        rawLinkRow({
          id: "link-1",
          orgId: "org-1",
          domainId: "dom-1",
          slug: "spring",
          destination: "https://example.com",
          title: "-dash",
          createdAt: 0,
        }),
      );
    const [header, ...body] = await rows();
    const map = detectColumns(header);
    expect(map).not.toBeNull();
    expect(readRows(body, map!, 2).rows).toEqual([
      { line: 2, host: HOST, slug: "spring", destination: "https://example.com/", title: "-dash" },
    ]);
  });

  it("still exports from a locked org", async () => {
    await env.DB.prepare("update orgs set locked_at = 1 where id = 'org-1'").run();
    expect((await exportCsv()).status).toBe(200);
  });
});
