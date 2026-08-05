import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import { now } from "../../src/worker/util";
import {
  applyTestMigrations,
  authEnv,
  freeOwnerCookie,
  sampleAddress,
  sampleLink,
} from "./support";

async function fetchWorker(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, authEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

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

beforeEach(applyTestMigrations);
afterEach(reset);

describe("GET /orgs/:orgId/stats: totalClicks vs totalClicksDelta (#24)", () => {
  it("only counts clicks inside the selected range, not every click ever", async () => {
    const cookie = await freeOwnerCookie();
    const db = await seedLinkOnExistingOrg();
    const t = now();

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

    await db.insert(schema.clicks).values(
      [...currentPeriod, ...previousPeriod, ...ancient].map((ts) => ({
        linkId: "link-1",
        orgId: "org-1",
        ts,
      })),
    );

    const res = await getStats(cookie);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalClicks).toBe(3);
    expect(body.totalClicksDelta).toEqual({ current: 3, previous: 2, pct: 50 });
  });
});

describe("GET /orgs/:orgId/links/stats/:slug: totalClicks vs totalClicksDelta (#24)", () => {
  it("only counts clicks inside the selected range, not every click ever", async () => {
    const cookie = await freeOwnerCookie();
    const db = await seedLinkOnExistingOrg();
    const t = now();
    const currentPeriod = [t - 1 * DAY_MS, t - 2 * DAY_MS]; // 2 clicks
    const previousPeriod = [t - 8 * DAY_MS]; // 1 click
    const ancient = [t - 200 * DAY_MS, t - 300 * DAY_MS];

    await db.insert(schema.clicks).values(
      [...currentPeriod, ...previousPeriod, ...ancient].map((ts) => ({
        linkId: "link-1",
        orgId: "org-1",
        ts,
      })),
    );

    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links/stats/sale", {
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalClicks).toBe(2);
    expect(body.totalClicksDelta).toEqual({ current: 2, previous: 1, pct: 100 });
  });
});
