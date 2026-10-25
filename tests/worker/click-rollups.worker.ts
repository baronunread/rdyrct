import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset, runDurableObjectAlarm } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import { insertClicks, type ClickMessage } from "../../src/worker/clicks";
import { computeWindows, ROLLUP_SWEEP_SQL, sweepOldRollups } from "../../src/worker/rollups";
import type { LinkStats, OrgStats } from "../../src/shared/types";
import {
  applyTestMigrations,
  clicksStub,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  rebuildClickRollups,
  rollupBackfill,
  rawAddressRow,
  rawLinkRow,
  resetClicks,
  testEnv,
} from "./support";

/**
 * The click rollups (#26): what the stats pages and the links list read.
 * These tests hold them to the raw clicks they are built from, through every
 * way a click gets written, and hold the stats routes to reading them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const LINKS = ["link-a", "link-b", "link-c"];
const COUNTRIES = ["US", "IT", "DE", ""];
const REFERRERS = ["", "news.ycombinator.com", "t.co"];
const DEVICES = ["desktop", "mobile", "bot"];

async function seedOrgWithLinks() {
  const cookie = await freeOwnerCookie();
  // Pro, so the stats routes look back 365 days and every seeded click is in
  // range.
  await env.DB.prepare("update user set plan = 'pro' where id = 'free-1'").run();
  const db = drizzle(env.DB, { schema });
  await db.batch([
    db.insert(schema.links).values(
      LINKS.map((id, i) =>
        rawLinkRow({
          id,
          orgId: "org-1",
          slug: id,
          destination: "https://example.com",
          createdAt: 0,
          utmCampaign: i === 0 ? "launch" : "",
          utmSource: i < 2 ? "newsletter" : "",
          utmMedium: "email",
        }),
      ),
    ),
    db.insert(schema.linkAddresses).values(
      LINKS.map((id) =>
        rawAddressRow({
          id: `addr-${id}`,
          linkId: id,
          orgId: "org-1",
          slug: id,
          kind: "primary",
          createdAt: 0,
        }),
      ),
    ),
  ]);
  return cookie;
}

/** A spread of clicks across links, 60 days, every hour of the day and every
 * dimension value, deterministic so a failure reproduces. */
function spreadClicks(count: number, now = Date.now()): ClickMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    dedupeId: `spread-${i}`,
    linkId: LINKS[i % LINKS.length]!,
    addressId: `addr-${LINKS[i % LINKS.length]}`,
    orgId: "org-1",
    ts: now - ((i * 7919 * 60_000) % (60 * DAY_MS)) - ((i * 31_337) % HOUR_MS),
    country: COUNTRIES[i % COUNTRIES.length]!,
    referrer: REFERRERS[(i >> 1) % REFERRERS.length]!,
    device: DEVICES[(i >> 2) % DEVICES.length]!,
  }));
}

type Grouped = { key: string; n: number }[];

async function grouped(sql: string): Promise<Grouped> {
  return (await env.DB.prepare(sql).all<{ key: string; n: number }>()).results;
}

/** Raw clicks and the three rollups, grouped the same way, so a test can say
 * "they agree" in one line. */
async function rawVsRollups() {
  const day = "date(ts / 1000, 'unixepoch')";
  return {
    dailyRaw: await grouped(
      `select org_id || '|' || link_id || '|' || ${day} as key, count(*) as n
       from clicks group by key order by key`,
    ),
    daily: await grouped(
      `select org_id || '|' || link_id || '|' || day as key, clicks as n from click_daily order by key`,
    ),
    dimsRaw: await grouped(
      `select key, count(*) as n from (
         select link_id || '|' || ${day} || '|country|' || country as key from clicks
         union all select link_id || '|' || ${day} || '|referrer|' || referrer from clicks
         union all select link_id || '|' || ${day} || '|device|' || device from clicks
       ) group by key order by key`,
    ),
    dims: await grouped(
      `select link_id || '|' || day || '|' || dim || '|' || value as key, clicks as n
       from click_daily_dims order by key`,
    ),
    hourlyRaw: await grouped(
      `select link_id || '|' || (ts - ts % 3600000) as key, count(*) as n from clicks group by key order by key`,
    ),
    hourly: await grouped(
      `select link_id || '|' || hour as key, clicks as n from click_hourly order by key`,
    ),
  };
}

async function expectReconciled() {
  const r = await rawVsRollups();
  expect(r.daily).toEqual(r.dailyRaw);
  expect(r.dims).toEqual(r.dimsRaw);
  expect(r.hourly).toEqual(r.hourlyRaw);
  return r;
}

/** Every rollup's total. Each click counts once per table, and once per
 * dimension in click_daily_dims. */
async function rollupTotal() {
  const row = await env.DB.prepare(
    `select (select coalesce(sum(clicks), 0) from click_daily) as daily,
            (select coalesce(sum(clicks), 0) from click_daily_dims where dim = 'country') as country,
            (select coalesce(sum(clicks), 0) from click_daily_dims where dim = 'referrer') as referrer,
            (select coalesce(sum(clicks), 0) from click_daily_dims where dim = 'device') as device,
            (select coalesce(sum(clicks), 0) from click_hourly) as hourly`,
  ).first<Record<"daily" | "country" | "referrer" | "device" | "hourly", number>>();
  return row;
}

const totals = (n: number) => ({ daily: n, country: n, referrer: n, device: n, hourly: n });

beforeEach(async () => {
  await applyTestMigrations();
  await resetClicks();
});
afterEach(reset);

describe("click rollups reconcile with raw clicks", () => {
  it("match raw clicks exactly, per link, day, dimension and hour", async () => {
    await seedOrgWithLinks();
    // 500 clicks through the real write path, in flush-sized batches.
    const rows = spreadClicks(500);
    for (let i = 0; i < rows.length; i += 100) {
      expect(await insertClicks(testEnv, rows.slice(i, i + 100))).toEqual({
        retry: [],
        hadFailure: false,
      });
    }

    const r = await expectReconciled();
    expect(r.dailyRaw.length).toBeGreaterThan(50);
    expect(await rollupTotal()).toEqual(totals(500));
  });

  it("count one big flush across several chunks", async () => {
    await seedOrgWithLinks();
    // More rows than one chunk holds, so the batch has several statements
    // of each kind.
    expect(await insertClicks(testEnv, spreadClicks(1000))).toEqual({
      retry: [],
      hadFailure: false,
    });

    await expectReconciled();
    expect(await rollupTotal()).toEqual(totals(1000));
  });

  it("count a redelivered click once, through the buffer and through insertClicks", async () => {
    await seedOrgWithLinks();
    const rows = spreadClicks(30);

    // The whole batch twice: a flush that wrote but was reported as failed.
    await insertClicks(testEnv, rows);
    await insertClicks(testEnv, rows);
    // Once more with a deleted link in it, so it falls back to per-row
    // writes, where every row is its own statement.
    await insertClicks(testEnv, [
      ...rows.slice(0, 5),
      { ...rows[0]!, dedupeId: "gone", linkId: "no-such-link" },
    ]);
    // And through the buffer's own alarm.
    const stub = clicksStub();
    await stub.add(rows[0]!);
    await runDurableObjectAlarm(stub);

    // The same id twice in one flush, in one chunk and across two.
    const twice = { ...rows[0]!, dedupeId: "twice" };
    await insertClicks(testEnv, [twice, twice]);
    await insertClicks(testEnv, [twice, ...spreadClicks(400).slice(30), twice]);

    expect(await rollupTotal()).toEqual(totals(401));
    await expectReconciled();
  });

  it("keep counting after raw clicks are trimmed, and go when the link goes", async () => {
    await seedOrgWithLinks();
    await insertClicks(testEnv, spreadClicks(60));

    // Raw retention removes rows; the rollups are what outlive them.
    await env.DB.prepare("delete from clicks").run();
    expect(await rollupTotal()).toEqual(totals(60));

    await env.DB.prepare("delete from links where id = 'link-a'").run();
    const left = await env.DB.prepare(
      "select count(*) as n from click_daily where link_id = 'link-a'",
    ).first<{ n: number }>();
    expect(left?.n).toBe(0);
    for (const table of ["click_daily_dims", "click_hourly"]) {
      const rows = await env.DB.prepare(
        `select count(*) as n from ${table} where link_id = 'link-a'`,
      ).first<{ n: number }>();
      expect(rows?.n).toBe(0);
    }
  });
});

describe("the backfill in migration 0042", () => {
  /** The backfill's INSERT ... SELECT statements, read from the migration
   * itself so the test runs what production ran. */
  function backfill() {
    expect(rollupBackfill()).toHaveLength(3);
    return rebuildClickRollups();
  }

  it("rebuilds the rollups from raw clicks, and running it again changes nothing", async () => {
    await seedOrgWithLinks();
    await insertClicks(testEnv, spreadClicks(200));
    // Clicks from before the migration: written while no rollup existed.
    await env.DB.batch([
      env.DB.prepare("delete from click_daily"),
      env.DB.prepare("delete from click_daily_dims"),
      env.DB.prepare("delete from click_hourly"),
    ]);

    await backfill();
    const once = await expectReconciled();

    await backfill();
    expect(await rawVsRollups()).toEqual(once);
  });

  it("runs one day range at a time, as its comment says, to the same rows", async () => {
    await seedOrgWithLinks();
    await insertClicks(testEnv, spreadClicks(200));
    const whole = await expectReconciled();
    await env.DB.batch([
      env.DB.prepare("delete from click_daily"),
      env.DB.prepare("delete from click_daily_dims"),
      env.DB.prepare("delete from click_hourly"),
    ]);

    // Two ranges split on a UTC day boundary: the first WHERE true in each
    // statement is the one that reads clicks.
    const split = Date.now() - (Date.now() % DAY_MS) - 30 * DAY_MS;
    for (const [from, to] of [
      [0, split],
      [split, Number.MAX_SAFE_INTEGER],
    ]) {
      await env.DB.batch(
        rollupBackfill().map((q) =>
          env.DB.prepare(q.replace("WHERE true", "WHERE true AND ts >= ? AND ts < ?")).bind(
            from,
            to,
          ),
        ),
      );
    }

    expect(await rawVsRollups()).toEqual(whole);
  });
});

describe("the stats routes read the rollups", () => {
  async function orgStats(cookie: string, days = 365) {
    const res = await fetchWorker(
      new Request(`http://localhost/api/orgs/org-1/stats?days=${days}`, { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    return jsonBody<OrgStats>(res);
  }

  it("serve every figure with no raw clicks left to count", async () => {
    const cookie = await seedOrgWithLinks();
    const now = Date.now();
    await insertClicks(testEnv, spreadClicks(300, now));
    const before = await orgStats(cookie);

    // If any figure still came from raw clicks, it would drop to zero here.
    await env.DB.prepare("delete from clicks").run();
    const after = await orgStats(cookie);

    expect(after).toEqual(before);
    expect(after.totalClicks).toBe(300);
    expect(after.series.reduce((n, p) => n + p.clicks, 0)).toBe(300);
    expect(after.heatmap.reduce((n, p) => n + p.clicks, 0)).toBe(300);
    expect(after.countries.reduce((n, p) => n + p.clicks, 0)).toBe(300);
    expect(after.devices.reduce((n, p) => n + p.clicks, 0)).toBe(300);
    expect(after.topLinks.reduce((n, p) => n + p.clicks, 0)).toBe(300);
    expect(after.campaigns).toEqual([{ campaign: "launch", clicks: 100 }]);
    expect(after.sources).toEqual([{ source: "newsletter", clicks: 200 }]);
    expect(after.mediums).toEqual([{ medium: "email", clicks: 300 }]);
    // The 24-hour chart holds exactly the clicks of the last 24 UTC hours.
    const since24h = computeWindows(1, now).since24h;
    const last24 = spreadClicks(300, now).filter((c) => c.ts >= since24h).length;
    expect(after.hourSeries.reduce((n, p) => n + p.clicks, 0)).toBe(last24);

    const linkRes = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links/stats/link-a", { headers: { cookie } }),
    );
    const link = await jsonBody<LinkStats>(linkRes);
    expect(link.totalClicks).toBe(100);
    expect(link.series.reduce((n, p) => n + p.clicks, 0)).toBe(100);

    const listRes = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links?sort=clicks", { headers: { cookie } }),
    );
    const list = await jsonBody<{ items: { id: string; clicks: number }[] }>(listRes);
    expect(list.items.map((l) => l.clicks)).toEqual([100, 100, 100]);
  });

  it("count the 24 hours the 24-hour chart draws, not today's UTC day", async () => {
    const cookie = await seedOrgWithLinks();
    const now = Date.now();
    const since24h = computeWindows(1, now).since24h;
    const at = (ts: number, i: number): ClickMessage => ({
      ...spreadClicks(1)[0]!,
      dedupeId: `h-${i}`,
      ts,
    });
    await insertClicks(testEnv, [
      at(since24h, 0), // first hour of the chart, often yesterday
      at(now, 1),
      at(since24h - 1, 2), // the 24 hours before
    ]);

    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/stats?bucket=hour", { headers: { cookie } }),
    );
    const stats = await jsonBody<OrgStats>(res);
    expect(stats.hourSeries.reduce((n, p) => n + p.clicks, 0)).toBe(2);
    expect(stats.totalClicks).toBe(2);
    expect(stats.totalClicksDelta).toEqual({ current: 2, previous: 1, pct: 100 });
  });

  it("count whole UTC days, so the total is the sum of the chart, and keep the plan's clamp", async () => {
    const cookie = await seedOrgWithLinks();
    await env.DB.prepare("update user set plan = 'free' where id = 'free-1'").run();
    const today = Date.now() - (Date.now() % DAY_MS);
    const at = (ts: number, i: number): ClickMessage => ({
      ...spreadClicks(1)[0]!,
      dedupeId: `w-${i}`,
      ts,
    });
    await insertClicks(testEnv, [
      at(today + 1, 0), // today
      at(today - 6 * DAY_MS, 1), // the first of the 7 days
      at(today - 6 * DAY_MS - 1, 2), // the last moment before them
      at(today - 13 * DAY_MS, 3), // the first of the 7 before
    ]);

    // Free shows 7 days whatever is asked for.
    const stats = await orgStats(cookie, 365);
    expect(stats.rangeDays).toBe(7);
    expect(stats.totalClicks).toBe(2);
    expect(stats.series.reduce((n, p) => n + p.clicks, 0)).toBe(2);
    // The heatmap reads the hourly table from the same first day.
    expect(stats.heatmap.reduce((n, p) => n + p.clicks, 0)).toBe(2);
    expect(stats.totalClicksDelta).toEqual({ current: 2, previous: 2, pct: 0 });
  });
});

describe("rollup retention", () => {
  it("drops rows past 400 days and keeps the rest", async () => {
    await seedOrgWithLinks();
    const now = Date.now();
    const click = (dedupeId: string, ageDays: number): ClickMessage => ({
      ...spreadClicks(1)[0]!,
      dedupeId,
      ts: now - ageDays * DAY_MS,
    });
    await insertClicks(testEnv, [click("old", 402), click("recent", 300)]);

    await sweepOldRollups(testEnv, now);

    expect(await rollupTotal()).toEqual(totals(1));
  });

  it("sweeps every org, in chunks, until nothing old is left", async () => {
    await seedOrgWithLinks();
    const db = drizzle(env.DB, { schema });
    await env.DB.prepare(
      "insert into orgs (id, name, created_at) values ('org-2', 'Other', 0)",
    ).run();
    await db.batch([
      db.insert(schema.links).values(
        rawLinkRow({
          id: "link-z",
          orgId: "org-2",
          slug: "link-z",
          destination: "https://example.com",
          createdAt: 0,
        }),
      ),
      db.insert(schema.linkAddresses).values(
        rawAddressRow({
          id: "addr-link-z",
          linkId: "link-z",
          orgId: "org-2",
          slug: "link-z",
          kind: "primary",
          createdAt: 0,
        }),
      ),
    ]);
    const now = Date.now();
    const click = (
      dedupeId: string,
      linkId: string,
      orgId: string,
      ageDays: number,
    ): ClickMessage => ({
      ...spreadClicks(1)[0]!,
      dedupeId,
      linkId,
      addressId: `addr-${linkId}`,
      orgId,
      ts: now - ageDays * DAY_MS,
    });
    // Five old link-days in org-1 and three in org-2, more than one chunk of
    // two in every table, plus one recent click each that must stay.
    await insertClicks(testEnv, [
      ...[401, 402, 403, 404, 405].map((age, i) => click(`old-1-${i}`, "link-a", "org-1", age)),
      ...[401, 410, 420].map((age, i) => click(`old-2-${i}`, "link-z", "org-2", age)),
      click("recent-1", "link-b", "org-1", 10),
      click("recent-2", "link-z", "org-2", 10),
    ]);

    await sweepOldRollups(testEnv, now, 2);

    const left = await grouped(
      `select 'daily|' || org_id as key, sum(clicks) as n from click_daily group by org_id
       union all select 'dims|' || org_id, sum(clicks) from click_daily_dims group by org_id
       union all select 'hourly|' || org_id, sum(clicks) from click_hourly group by org_id
       order by key`,
    );
    // Three dimension rows per click.
    expect(left).toEqual([
      { key: "daily|org-1", n: 1 },
      { key: "daily|org-2", n: 1 },
      { key: "dims|org-1", n: 3 },
      { key: "dims|org-2", n: 3 },
      { key: "hourly|org-1", n: 1 },
      { key: "hourly|org-2", n: 1 },
    ]);
  });

  it("skips an org created after the cutoff", async () => {
    await seedOrgWithLinks();
    const now = Date.now();
    const db = drizzle(env.DB, { schema });
    await env.DB.prepare("insert into orgs (id, name, created_at) values ('org-new', 'New', ?)")
      .bind(now)
      .run();
    await db.batch([
      db.insert(schema.links).values(
        rawLinkRow({
          id: "link-new",
          orgId: "org-new",
          slug: "link-new",
          destination: "https://example.com",
          createdAt: now,
        }),
      ),
      db.insert(schema.linkAddresses).values(
        rawAddressRow({
          id: "addr-link-new",
          linkId: "link-new",
          orgId: "org-new",
          slug: "link-new",
          kind: "primary",
          createdAt: now,
        }),
      ),
    ]);
    // A row older than its org cannot happen (every row is dated by its
    // redirect), which is why the sweep does not look. Planting one is how
    // this test sees that it did not.
    await insertClicks(testEnv, [
      {
        ...spreadClicks(1)[0]!,
        dedupeId: "planted",
        linkId: "link-new",
        addressId: "addr-link-new",
        orgId: "org-new",
        ts: now - 402 * DAY_MS,
      },
    ]);

    await sweepOldRollups(testEnv, now);

    const left = await grouped(
      `select 'daily' as key, sum(clicks) as n from click_daily where org_id = 'org-new'
       union all select 'hourly', sum(clicks) from click_hourly where org_id = 'org-new'`,
    );
    expect(left).toEqual([
      { key: "daily", n: 1 },
      { key: "hourly", n: 1 },
    ]);
  });

  it("spends one D1 query per hundred orgs", async () => {
    await seedOrgWithLinks();
    // 250 more old orgs, 251 with org-1: three statements each, 753 in all.
    await env.DB.prepare(
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < 250)
       insert into orgs (id, name, created_at) select 'bulk-' || i, 'Bulk', 0 from n`,
    ).run();
    const batch = vi.spyOn(testEnv.DB, "batch");

    await sweepOldRollups(testEnv);
    const batches = batch.mock.calls.length;
    batch.mockRestore();

    // A batch counts once against the Worker's query limit however many
    // statements it holds: 753 statements fit in three.
    expect(batches).toBe(3);
  });
});

describe("query plans", () => {
  // Captured here rather than in a doc so a schema change that loses an
  // index fails a test instead of quietly scanning the table.
  async function plan(sql: string, ...binds: (string | number)[]) {
    const { results } = await env.DB.prepare(`explain query plan ${sql}`)
      .bind(...binds)
      .all<{ detail: string }>();
    return results.map((r) => r.detail).join("\n");
  }

  // Every read the stats routes make, by what it filters on. None may touch
  // raw clicks, and each must read a contiguous range of a key or a covering
  // index, never scan a table.
  const reads: [string, string, (string | number)[], RegExp][] = [
    [
      "org totals and series",
      "select day, sum(clicks) from click_daily where org_id = ? and day >= ? group by day",
      ["org-1", "2026-01-01"],
      /SEARCH click_daily USING PRIMARY KEY \(org_id=\? AND day>\?\)/,
    ],
    [
      "org breakdown",
      "select value, sum(clicks) from click_daily_dims where org_id = ? and dim = ? and day >= ? group by value",
      ["org-1", "country", "2026-01-01"],
      /SEARCH click_daily_dims USING PRIMARY KEY \(org_id=\? AND dim=\? AND day>\?\)/,
    ],
    [
      "heatmap and 24-hour chart",
      "select hour, sum(clicks) from click_hourly where org_id = ? and hour >= ? group by hour",
      ["org-1", 0],
      /SEARCH click_hourly USING PRIMARY KEY \(org_id=\? AND hour>\?\)/,
    ],
    [
      "one link's series",
      "select day, sum(clicks) from click_daily where link_id = ? and day >= ? group by day",
      ["link-a", "2026-01-01"],
      /SEARCH click_daily USING COVERING INDEX idx_click_daily_link \(link_id=\? AND day>\?\)/,
    ],
    [
      "one link's breakdown",
      "select value, sum(clicks) from click_daily_dims where link_id = ? and dim = ? and day >= ? group by value",
      ["link-a", "country", "2026-01-01"],
      /SEARCH click_daily_dims USING COVERING INDEX idx_click_daily_dims_link \(link_id=\? AND dim=\? AND day>\?\)/,
    ],
    [
      "the links list total",
      "select coalesce(sum(clicks), 0) from click_daily where link_id = ?",
      ["link-a"],
      /SEARCH click_daily USING COVERING INDEX idx_click_daily_link \(link_id=\?\)/,
    ],
  ];

  it.each(reads)("%s", async (_name, sql, binds, expected) => {
    const detail = await plan(sql, ...binds);
    expect(detail).toMatch(expected);
    expect(detail).not.toMatch(/\bSCAN\b/);
  });

  // The retention sweep reads only the key range it deletes. A bare
  // `day < ?` reads every row of the table, since every key starts with
  // org_id and every other index with link_id.
  it.each([
    [0, "2025-01-01", /SEARCH click_daily USING PRIMARY KEY \(org_id=\? AND day<\?\)/],
    [
      1,
      "2025-01-01",
      /SEARCH click_daily_dims USING PRIMARY KEY \(org_id=\? AND dim=\? AND day<\?\)/,
    ],
    [2, 0, /SEARCH click_hourly USING PRIMARY KEY \(org_id=\? AND hour<\?\)/],
  ] as const)("retention sweep statement %i", async (i, cutoff, expected) => {
    const detail = await plan(ROLLUP_SWEEP_SQL[i], "org-1", cutoff, 1000);
    expect(detail).toMatch(expected);
    expect(detail).not.toMatch(/\bSCAN\b/);
  });

  it("checks a flush's dedupe ids against the index, not the table", async () => {
    const detail = await plan(
      "select 1 from json_each(?) i where not exists (select 1 from clicks c where c.dedupe_id = i.value ->> 6)",
      "[]",
    );
    expect(detail).toContain("USING COVERING INDEX idx_clicks_dedupe_id (dedupe_id=?)");
  });
});
