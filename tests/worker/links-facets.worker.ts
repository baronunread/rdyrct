import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import type { LinkFacets, LinkListItem } from "../../src/shared/types";
import { applyTestMigrations, fetchWorker, freeOwnerCookie, jsonBody } from "./support";

/**
 * The chips above the links table and the sparkline in each row: the counts
 * (GET /links/facets), the `filter=` that narrows the list to a chip, and the
 * 14-day series and attention note on every listed link.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const OLD = NOW - 30 * DAY_MS;
const dayKey = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString().slice(0, 10);

interface Seed {
  id: string;
  createdAt?: number;
  /** Clicks by days ago. */
  clicks?: Record<number, number>;
  extra?: Partial<{ suspended_at: number; warned_at: number; qr_color: string; domain_id: string }>;
  org?: string;
}

async function seedLink({ id, createdAt = NOW, clicks = {}, extra = {}, org = "org-1" }: Seed) {
  const cols = Object.keys(extra);
  await env.DB.prepare(
    `insert into links (id, org_id, slug, destination, created_at${cols.map((c) => `, ${c}`).join("")})
     values (?, ?, ?, 'https://example.com', ?${cols.map(() => ", ?").join("")})`,
  )
    .bind(id, org, id, createdAt, ...Object.values(extra))
    .run();
  for (const [ago, n] of Object.entries(clicks))
    await env.DB.prepare(
      "insert into click_daily (org_id, day, link_id, clicks) values (?, ?, ?, ?)",
    )
      .bind(org, dayKey(Number(ago)), id, n)
      .run();
}

/** One of each case the chips tell apart. */
async function seedOrg() {
  const cookie = await freeOwnerCookie({ id: "dom-1", hostname: "go.example.test" });
  await seedLink({ id: "quiet", createdAt: OLD, clicks: { 20: 5 } });
  await seedLink({ id: "never", createdAt: OLD });
  await seedLink({ id: "fresh" });
  await seedLink({ id: "drop", createdAt: OLD, clicks: { 10: 20, 2: 3 } });
  // Down by more than half, but from too few clicks to mean anything.
  await seedLink({ id: "small-drop", createdAt: OLD, clicks: { 10: 6, 1: 1 } });
  await seedLink({ id: "steady", createdAt: OLD, clicks: { 10: 10, 2: 8 } });
  await seedLink({ id: "paused", extra: { suspended_at: NOW } });
  await seedLink({ id: "warned", extra: { warned_at: NOW } });
  await seedLink({ id: "qr", extra: { qr_color: "#112233" } });
  await seedLink({ id: "custom", extra: { domain_id: "dom-1" } });
  return cookie;
}

const ATTENTION = ["drop", "never", "paused", "quiet", "warned"];

async function get<T>(cookie: string, path: string): Promise<T> {
  const res = await fetchWorker(
    new Request(`http://localhost/api/orgs/org-1/links${path}`, { headers: { cookie } }),
  );
  expect(res.status).toBe(200);
  return jsonBody<T>(res);
}

const list = (cookie: string, query: string) =>
  get<{ items: LinkListItem[]; nextCursor: string | null }>(cookie, `?limit=100&${query}`);

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

describe("GET /orgs/:orgId/links/facets", () => {
  it("counts each chip over the org's links", async () => {
    const cookie = await seedOrg();
    // Another org's links never count.
    await env.DB.prepare(
      "insert into orgs (id, name, created_at) values ('org-2', 'Other', 0)",
    ).run();
    await seedLink({ id: "elsewhere", createdAt: OLD, org: "org-2" });

    expect(await get<LinkFacets>(cookie, "/facets")).toEqual({
      all: 10,
      attention: ATTENTION.length,
      qr: 1,
      customDomain: 1,
    });
  });

  it("is refused to somebody outside the org", async () => {
    await seedOrg();
    const res = await fetchWorker(new Request("http://localhost/api/orgs/org-1/links/facets"));
    expect(res.status).toBe(401);
  });
});

describe("GET /orgs/:orgId/links?filter=", () => {
  it("lists exactly the links each chip counts", async () => {
    const cookie = await seedOrg();
    const ids = async (filter: string) =>
      (await list(cookie, `filter=${filter}`)).items.map((l) => l.id).sort();

    expect(await ids("attention")).toEqual(ATTENTION);
    expect(await ids("qr")).toEqual(["qr"]);
    expect(await ids("custom")).toEqual(["custom"]);
    expect(await ids("all")).toHaveLength(10);
    // Anything else is the whole list, not an error.
    expect(await ids("nonsense")).toHaveLength(10);
  });

  it("keeps search on top of the chip", async () => {
    const cookie = await seedOrg();
    const page = await list(cookie, "filter=attention&q=never");
    expect(page.items.map((l) => l.id)).toEqual(["never"]);
  });
});

describe("the links list's sparkline and attention note", () => {
  it("sends 7 zero-filled days per link on every plan, oldest first", async () => {
    const cookie = await seedOrg();
    const { items } = await list(cookie, "");
    const drop = items.find((l) => l.id === "drop")!;

    // One week, the free plan's analytics window, whatever the plan.
    expect(drop.spark).toHaveLength(7);
    expect(drop.spark[4]).toBe(3); // 2 days ago
    // 10 days ago is outside the week, so it is not in the line.
    expect(drop.spark.reduce((a, b) => a + b, 0)).toBe(3);
    expect(items.find((l) => l.id === "quiet")!.spark).toEqual(Array.from({ length: 7 }, () => 0));
  });

  it("words the same rule the attention chip counts", async () => {
    const cookie = await seedOrg();
    const { items } = await list(cookie, "");
    const note = Object.fromEntries(items.map((l) => [l.id, l.attention]));

    expect(note).toEqual({
      quiet: "No clicks in 7 days",
      never: "No clicks yet",
      fresh: null,
      drop: "85% fewer clicks",
      "small-drop": null,
      steady: null,
      // The table's "paused" badge already says it.
      paused: null,
      warned: "Visitors see a warning",
      qr: null,
      custom: null,
    });
  });
});
