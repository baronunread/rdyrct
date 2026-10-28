import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import type { LinkStats, OrgStats } from "../../src/shared/types";
import {
  applyTestMigrations,
  fetchWorker,
  jsonBody,
  freeOwnerCookie,
  rebuildClickRollups,
  sampleAddress,
  sampleLink,
} from "./support";

async function getStats(cookie: string, orgId = "org-1"): Promise<Response> {
  return fetchWorker(
    new Request(`http://localhost/api/orgs/${orgId}/stats`, { headers: { cookie } }),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

// freeOwnerCookie() already seeds "org-1"; this adds link-1/addr-1 on top of
// it (unlike seedLink(), which also inserts "org-1" and would collide).
async function seedLinkOnExistingOrg() {
  const db = drizzle(env.DB, { schema });
  await db.batch([
    db.insert(schema.links).values({ ...sampleLink, createdAt: 0 }),
    db.insert(schema.linkAddresses).values({ ...sampleAddress, createdAt: 0 }),
  ]);
  return db;
}

async function seedClicks(db: ReturnType<typeof drizzle>, timestamps: number[]) {
  await db.insert(schema.clicks).values(
    timestamps.map((ts) => ({
      linkId: "link-1",
      orgId: "org-1",
      ts,
    })),
  );
  await rebuildClickRollups();
}

beforeEach(applyTestMigrations);
afterEach(reset);

/** The org, link and clock the range tests below both start from. */
async function seededOrg() {
  return { cookie: await freeOwnerCookie(), db: await seedLinkOnExistingOrg(), t: Date.now() };
}

describe("GET /orgs/:orgId/stats: totalClicks vs totalClicksDelta (#24)", () => {
  it("only counts clicks inside the selected range, not every click ever", async () => {
    const { cookie, db, t } = await seededOrg();

    // Free plan's analyticsDays is 7: "current period" is the last 7 days,
    // "previous period" the 7 days before that, both equal-length.
    const currentPeriod = [t - 1 * DAY_MS, t - 2 * DAY_MS, t - 3 * DAY_MS]; // 3 clicks
    const previousPeriod = [t - 8 * DAY_MS, t - 9 * DAY_MS]; // 2 clicks
    // Clicks from long before either window: with the old unbounded query
    // these leaked into "totalClicks", making its delta against
    // totalClicksPrev (a real 7-day window) meaningless.
    const ancient = [
      t - 100 * DAY_MS,
      t - 200 * DAY_MS,
      t - 300 * DAY_MS,
      t - 400 * DAY_MS,
      t - 500 * DAY_MS,
    ];

    await seedClicks(db, [...currentPeriod, ...previousPeriod, ...ancient]);

    const res = await getStats(cookie);
    expect(res.status).toBe(200);
    const body = await jsonBody<OrgStats>(res);

    expect(body.totalClicks).toBe(3);
    expect(body.totalClicksDelta).toEqual({ current: 3, previous: 2, pct: 50 });
  });
});

describe("GET /orgs/:orgId/links/stats/:slug: totalClicks vs totalClicksDelta (#24)", () => {
  it("only counts clicks inside the selected range, not every click ever", async () => {
    const { cookie, db, t } = await seededOrg();
    const currentPeriod = [t - 1 * DAY_MS, t - 2 * DAY_MS]; // 2 clicks
    const previousPeriod = [t - 8 * DAY_MS]; // 1 click
    const ancient = [t - 200 * DAY_MS, t - 300 * DAY_MS];

    await seedClicks(db, [...currentPeriod, ...previousPeriod, ...ancient]);

    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links/stats/sale", {
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<LinkStats>(res);

    expect(body.totalClicks).toBe(2);
    expect(body.totalClicksDelta).toEqual({ current: 2, previous: 1, pct: 100 });
  });
});

describe("GET /orgs/:orgId/links/stats/:slug?days=", () => {
  async function linkStats(cookie: string, days: number) {
    const res = await fetchWorker(
      new Request(`http://localhost/api/orgs/org-1/links/stats/sale?days=${days}`, {
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    return jsonBody<LinkStats>(res);
  }

  it("covers the range asked for", async () => {
    const { cookie, db, t } = await seededOrg();
    await env.DB.prepare("update user set plan = 'pro' where id = 'free-1'").run();
    await seedClicks(db, [t - 2 * DAY_MS, t - 20 * DAY_MS, t - 100 * DAY_MS]);

    const week = await linkStats(cookie, 7);
    expect(week.rangeDays).toBe(7);
    expect(week.series).toHaveLength(7);
    expect(week.totalClicks).toBe(1);

    const month = await linkStats(cookie, 30);
    expect(month.rangeDays).toBe(30);
    expect(month.totalClicks).toBe(2);
  });

  it("clamps the range to the plan, as the org's stats do", async () => {
    const { cookie, db, t } = await seededOrg();
    await seedClicks(db, [t - 2 * DAY_MS, t - 20 * DAY_MS]);

    // Free keeps 7 days.
    const body = await linkStats(cookie, 365);
    expect(body.rangeDays).toBe(7);
    expect(body.totalClicks).toBe(1);
  });
});

describe("GET /orgs/:orgId/stats: the links lists", () => {
  it("ranks top links over the range, and names their domain", async () => {
    const cookie = await freeOwnerCookie({ id: "dom-1", hostname: "go.example.test" });
    const t = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "insert into links (id, org_id, slug, destination, created_at) values ('old', 'org-1', 'old', 'https://example.com', 0)",
      ),
      env.DB.prepare(
        "insert into links (id, org_id, domain_id, slug, destination, created_at) values ('new', 'org-1', 'dom-1', 'new', 'https://example.com', 0)",
      ),
      env.DB.prepare(
        "insert into links (id, org_id, domain_id, slug, destination, created_at) values ('gone', 'org-1', 'dom-1', 'gone', 'https://example.com', 0)",
      ),
    ]);
    const db = drizzle(env.DB, { schema });
    await db.insert(schema.clicks).values([
      // Busy, but before the free plan's 7 days.
      ...Array.from({ length: 5 }, () => ({ linkId: "old", orgId: "org-1", ts: t - 20 * DAY_MS })),
      { linkId: "new", orgId: "org-1", ts: t - 2 * DAY_MS },
      { linkId: "gone", orgId: "org-1", ts: t - 40 * DAY_MS },
    ]);
    await rebuildClickRollups();

    const body = await jsonBody<OrgStats>(await getStats(cookie));
    expect(body.topLinks).toEqual([
      { id: "new", slug: "new", title: "", domain: "go.example.test", clicks: 1 },
    ]);
    expect(body.deadLinks).toEqual([
      { id: "gone", slug: "gone", title: "", domain: "go.example.test" },
    ]);
    // An empty range is not an org that never had a click.
    expect(body.everClicked).toBe(true);
  });

  it("says when the org has never had a click", async () => {
    const { cookie } = await seededOrg();
    const body = await jsonBody<OrgStats>(await getStats(cookie));
    expect(body.everClicked).toBe(false);
    expect(body.topLinks).toEqual([]);
  });
});
