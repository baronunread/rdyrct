import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import type { OrgInsights } from "../../src/shared/types";
import {
  applyTestMigrations,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  sampleAddress,
  sampleLink,
} from "./support";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

beforeEach(applyTestMigrations);
afterEach(reset);

async function getInsights(cookie: string, days = 7): Promise<OrgInsights> {
  const res = await fetchWorker(
    new Request(`http://localhost/api/orgs/org-1/insights?days=${days}`, { headers: { cookie } }),
  );
  expect(res.status).toBe(200);
  return jsonBody<OrgInsights>(res);
}

/** Free owner, link-1 ("sale") and room to write rollup rows by hand. */
async function seeded() {
  const cookie = await freeOwnerCookie();
  const db = drizzle(env.DB, { schema });
  await db.batch([
    db.insert(schema.links).values({ ...sampleLink, createdAt: 0 }),
    db.insert(schema.linkAddresses).values({ ...sampleAddress, createdAt: 0 }),
  ]);
  return cookie;
}

const daily = (day: string, clicks: number) =>
  env.DB.prepare(
    "insert into click_daily (org_id, day, link_id, clicks) values ('org-1', ?, 'link-1', ?)",
  ).bind(day, clicks);

const dim = (dimension: string, day: string, value: string, clicks: number) =>
  env.DB.prepare(
    "insert into click_daily_dims (org_id, dim, day, value, link_id, clicks) values ('org-1', ?, ?, ?, 'link-1', ?)",
  ).bind(dimension, day, value, clicks);

describe("GET /orgs/:orgId/insights", () => {
  it("names a country that rose sharply and a link that fell", async () => {
    const cookie = await seeded();
    await env.DB.batch([
      daily(dayAgo(1), 10),
      daily(dayAgo(9), 80),
      dim("country", dayAgo(1), "BE", 30),
      dim("country", dayAgo(9), "BE", 20),
    ]);
    const body = await getInsights(cookie);
    expect(body.insights.map((i) => i.kind)).toEqual(["country", "link_fell"]);
    expect(body.insights[0]).toMatchObject({ country: "BE", current: 30, previous: 20, pct: 50 });
    expect(body.insights[1]).toMatchObject({ current: 10, previous: 80, pct: 88 });
    expect(body.minor).toBeNull();
  });

  it("ignores moves below the volume floor, and offers the biggest as minor", async () => {
    const cookie = await seeded();
    await env.DB.batch([
      daily(dayAgo(1), 2),
      daily(dayAgo(9), 1),
      dim("country", dayAgo(1), "BE", 2),
      dim("country", dayAgo(9), "BE", 1),
      dim("country", dayAgo(1), "FR", 1),
      dim("country", dayAgo(9), "FR", 5),
    ]);
    const body = await getInsights(cookie);
    expect(body.insights).toEqual([]);
    expect(body.minor).toMatchObject({ kind: "country", country: "FR", previous: 5, current: 1 });
  });

  it("says nothing at all when the changes are one click", async () => {
    const cookie = await seeded();
    await env.DB.batch([dim("country", dayAgo(1), "BE", 2), dim("country", dayAgo(9), "BE", 1)]);
    const body = await getInsights(cookie);
    expect(body.insights).toEqual([]);
    expect(body.minor).toBeNull();
  });

  it("finds a referrer a link never had before the range", async () => {
    const cookie = await seeded();
    await env.DB.batch([
      daily(dayAgo(9), 20),
      dim("referrer", dayAgo(9), "google.com", 20),
      dim("referrer", dayAgo(2), "instagram.com", 12),
      dim("referrer", dayAgo(1), "instagram.com", 26),
      dim("referrer", dayAgo(1), "google.com", 5),
    ]);
    const body = await getInsights(cookie);
    const found = body.insights.find((i) => i.kind === "first_referrer");
    expect(found).toMatchObject({ referrer: "instagram.com", clicks: 38, since: dayAgo(2) });
  });

  it("does not call a link's first ever clicks a new referrer", async () => {
    const cookie = await seeded();
    await env.DB.batch([dim("referrer", dayAgo(1), "instagram.com", 30)]);
    const body = await getInsights(cookie);
    expect(body.insights.some((i) => i.kind === "first_referrer")).toBe(false);
  });

  it("compares whole days for the 24-hour view", async () => {
    const cookie = await seeded();
    await env.DB.batch([
      dim("country", dayAgo(1), "BE", 40),
      dim("country", dayAgo(2), "BE", 10),
      // Today is partial and must not count against yesterday.
      dim("country", dayAgo(0), "BE", 1),
    ]);
    const body = await getInsights(cookie, 1);
    expect(body.days).toBe(1);
    expect(body.insights[0]).toMatchObject({ country: "BE", current: 40, previous: 10 });
  });

  it("refuses somebody who is not signed in", async () => {
    await seeded();
    const res = await fetchWorker(new Request("http://localhost/api/orgs/org-1/insights"));
    expect(res.status).toBe(401);
  });
});
