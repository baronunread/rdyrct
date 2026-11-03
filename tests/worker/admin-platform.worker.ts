import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import * as schema from "../../src/worker/db/schema";
import { AVATAR_PREFIX } from "../../src/worker/storage";
import { reconcileUser } from "../../src/worker/reconcile";
import { usageRange } from "../../src/worker/admin-usage";
import type {
  AdminActionRow,
  AdminLinkCounts,
  AdminLinkRow,
  AdminOrgRow,
  AdminUsage,
  AdminUserRow,
} from "../../src/shared/types";
import { Webhook } from "standardwebhooks";
import {
  adminCookie,
  applyTestMigrations,
  billingEnv,
  POLAR_PRO_PRODUCT_ID,
  POLAR_WEBHOOK_SECRET,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  rawLinkRow,
  testDb,
  unreachableBilling,
} from "./support";

/**
 * What the redesigned platform-admin screens read: the usage range, the
 * per-row extras on the Users and Organizations lists, the link counts, and
 * Polar's plan changes in the audit log.
 */

const DAY = 86_400_000;
const dayKey = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

beforeEach(applyTestMigrations);
afterEach(() => reset());

const get = (path: string, cookie: string) =>
  fetchWorker(new Request(`http://localhost/api${path}`, { headers: { cookie } }));

async function admin<T>(path: string, cookie: string): Promise<T> {
  const res = await get(path, cookie);
  expect(res.status).toBe(200);
  return jsonBody<T>(res);
}

/** org-1 (owned by free-1, from freeOwnerCookie) with three links. */
async function seedLinks() {
  const db = testDb();
  await db.insert(schema.links).values([
    rawLinkRow({
      id: "link-a",
      orgId: "org-1",
      slug: "a",
      destination: "https://a.example",
      createdAt: Date.now(),
      createdBy: "free-1",
      riskScore: 100,
      riskReasons: JSON.stringify(["web_risk_social_engineering"]),
    }),
    rawLinkRow({
      id: "link-b",
      orgId: "org-1",
      slug: "b",
      destination: "https://b.example",
      createdAt: Date.now() - 20 * DAY,
      createdBy: "free-1",
      riskScore: 100,
      riskReasons: JSON.stringify(["dns_blocklist"]),
      suspendedAt: Date.now(),
    }),
    rawLinkRow({
      id: "link-c",
      orgId: "org-1",
      slug: "c",
      destination: "https://c.example",
      createdAt: Date.now() - 60 * DAY,
      warnedAt: Date.now(),
    }),
  ]);
  await db.insert(schema.linkReports).values([
    { id: "r-1", slug: "c", linkId: "link-c", orgId: "org-1", reason: "spam", createdAt: 0 },
    {
      id: "r-2",
      slug: "b",
      linkId: "link-b",
      orgId: "org-1",
      reason: "spam",
      status: "dismissed",
      createdAt: 0,
    },
  ]);
}

/** Clicks on the rollups, which is all the admin figures read. */
async function seedClicks() {
  const db = testDb();
  await db.insert(schema.clickDaily).values([
    { orgId: "org-1", day: dayKey(0), linkId: "link-a", clicks: 5 },
    { orgId: "org-1", day: dayKey(20), linkId: "link-b", clicks: 7 },
    { orgId: "org-1", day: dayKey(60), linkId: "link-c", clicks: 11 },
  ]);
  await db.insert(schema.clickDailyDims).values([
    { orgId: "org-1", dim: "device", day: dayKey(0), value: "bot", linkId: "link-a", clicks: 2 },
    { orgId: "org-1", dim: "device", day: dayKey(60), value: "bot", linkId: "link-c", clicks: 3 },
  ]);
}

const sum = (points: { clicks: number }[]) => points.reduce((n, p) => n + p.clicks, 0);

describe("GET /api/admin/usage?days=", () => {
  it("reads 7, 30 or 90, and 30 for anything else", () => {
    expect(usageRange("7")).toBe(7);
    expect(usageRange("90")).toBe(90);
    expect(usageRange("365")).toBe(30);
    expect(usageRange(undefined)).toBe(30);
  });

  it("covers the range it was asked for, clicks from the rollups included", async () => {
    await freeOwnerCookie();
    await seedLinks();
    await seedClicks();
    const cookie = await adminCookie();

    const week = await admin<AdminUsage>("/admin/usage?days=7", cookie);
    expect(week.days).toBe(7);
    for (const series of [week.series, week.signups, week.botSeries, week.linkSeries])
      expect(series).toHaveLength(7);
    expect(sum(week.series)).toBe(5);
    expect(sum(week.botSeries)).toBe(2);
    expect(sum(week.linkSeries)).toBe(1);
    expect(week.topLinks.map((l) => l.slug)).toEqual(["a"]);

    const month = await admin<AdminUsage>("/admin/usage", cookie);
    expect(month.days).toBe(30);
    expect(sum(month.series)).toBe(12);
    expect(sum(month.linkSeries)).toBe(2);
    expect(month.topLinks.map((l) => l.slug)).toEqual(["b", "a"]);

    const quarter = await admin<AdminUsage>("/admin/usage?days=90", cookie);
    expect(quarter.days).toBe(90);
    expect(quarter.series).toHaveLength(90);
    expect(sum(quarter.series)).toBe(23);
    expect(sum(quarter.botSeries)).toBe(5);
    expect(sum(quarter.linkSeries)).toBe(3);
    expect(quarter.topOrgs).toEqual([{ id: "org-1", name: "Test", clicks: 23, plan: "free" }]);
    expect(quarter.topLinks.map((l) => l.slug)).toEqual(["c", "b", "a"]);
  });

  it("splits the range's sign-ups by the plan each holds", async () => {
    const db = testDb();
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);
    await db.insert(schema.user).values([
      { id: "u-1", name: "A", email: "a@x.test", plan: "pro", createdAt: at(1), updatedAt: at(1) },
      {
        id: "u-2",
        name: "B",
        email: "b@x.test",
        plan: "hobby",
        createdAt: at(10),
        updatedAt: at(1),
      },
      {
        id: "u-3",
        name: "C",
        email: "c@x.test",
        plan: "free",
        createdAt: at(50),
        updatedAt: at(1),
      },
    ]);
    const cookie = await adminCookie();
    // The admin's own account is dated 1970, outside every range.
    expect((await admin<AdminUsage>("/admin/usage?days=7", cookie)).signupsByPlan).toEqual({
      free: 0,
      hobby: 0,
      pro: 1,
    });
    expect((await admin<AdminUsage>("/admin/usage?days=90", cookie)).signupsByPlan).toEqual({
      free: 1,
      hobby: 1,
      pro: 1,
    });
  });
});

describe("GET /api/admin/users", () => {
  it("counts each person's links across orgs, and names an admin URL for an uploaded picture", async () => {
    await freeOwnerCookie();
    await seedLinks();
    await env.DB.prepare(
      "update user set image = '/api/user/avatar?v=42' where id = 'free-1'",
    ).run();
    const users = await admin<AdminUserRow[]>("/admin/users", await adminCookie());
    const free = users.find((u) => u.id === "free-1");
    expect(free?.links).toBe(2);
    expect(free?.image).toBe("/api/admin/users/free-1/avatar?v=42");
    const self = users.find((u) => u.id === "admin-1");
    expect(self?.links).toBe(0);
    expect(self?.image).toBeNull();
  });
});

describe("GET /api/admin/users/:id/avatar", () => {
  it("serves the picture to an admin, cached like the owner's own", async () => {
    await env.MEDIA.put(`${AVATAR_PREFIX}free-1`, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await freeOwnerCookie();
    const res = await get("/admin/users/free-1/avatar?v=1", await adminCookie());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    );
  });

  it("is a 404 for anyone else, even for their own picture", async () => {
    await env.MEDIA.put(`${AVATAR_PREFIX}free-1`, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    const cookie = await freeOwnerCookie();
    expect((await get("/admin/users/free-1/avatar", cookie)).status).toBe(404);
  });

  it("is a 404 when there is no picture", async () => {
    await freeOwnerCookie();
    expect((await get("/admin/users/free-1/avatar", await adminCookie())).status).toBe(404);
  });
});

describe("GET /api/admin/orgs", () => {
  it("carries clicks over 30 days, and the plan state each row shows", async () => {
    await freeOwnerCookie();
    await seedLinks();
    await seedClicks();
    const now = Date.now();
    const db = testDb();
    await db.insert(schema.orgs).values([
      { id: "org-grace", name: "Grace", createdAt: 1 },
      { id: "org-ended", name: "Ended", createdAt: 2, lockedAt: now - 40 * DAY },
    ]);
    await db.insert(schema.orgEntitlements).values([
      {
        orgId: "org-grace",
        plan: "free",
        overJson: JSON.stringify({ links: 30 }),
        graceEndsAt: now + 10 * DAY,
        reconciledAt: now,
      },
      {
        orgId: "org-ended",
        plan: "free",
        overJson: JSON.stringify({ domains: 1 }),
        graceEndsAt: now - 10 * DAY,
        reconciledAt: now,
      },
      // Inside its plan: a row is no verdict on its own.
      { orgId: "org-1", plan: "free", overJson: "{}", graceEndsAt: null, reconciledAt: now },
    ]);
    await db.insert(schema.domains).values([
      {
        id: "d-grace",
        orgId: "org-grace",
        hostname: "grace.example",
        status: "active",
        lockedAt: now - DAY,
        createdAt: 0,
      },
      {
        id: "d-ended",
        orgId: "org-ended",
        hostname: "ended.example",
        status: "active",
        lockedAt: now - 40 * DAY,
        createdAt: 0,
      },
    ]);

    const orgs = await admin<AdminOrgRow[]>("/admin/orgs", await adminCookie());
    const byId = new Map(orgs.map((o) => [o.id, o]));
    expect(byId.get("org-1")).toMatchObject({
      clicks: 23,
      clicks30d: 12,
      overPlan: false,
      graceEndsAt: null,
      lockedAt: null,
      domainStoppedAt: null,
    });
    // Still in its grace period: the locked domain serves until it ends.
    expect(byId.get("org-grace")).toMatchObject({
      overPlan: true,
      graceEndsAt: now + 10 * DAY,
      lockedAt: null,
      domainStoppedAt: null,
    });
    expect(byId.get("org-ended")).toMatchObject({
      overPlan: true,
      graceEndsAt: now - 10 * DAY,
      lockedAt: now - 40 * DAY,
      domainStoppedAt: now - 10 * DAY,
    });
  });
});

describe("GET /api/admin/links/counts and the list's filters", () => {
  it("counts every filter under the search and org, past the list's cap", async () => {
    await freeOwnerCookie();
    await seedLinks();
    const cookie = await adminCookie();
    expect(await admin<AdminLinkCounts>("/admin/links/counts", cookie)).toEqual({
      all: 3,
      reported: 1,
      flagged: 1,
      suspended: 1,
      warned: 1,
    });
    expect(await admin<AdminLinkCounts>("/admin/links/counts?q=b.example", cookie)).toEqual({
      all: 1,
      reported: 0,
      flagged: 0,
      suspended: 1,
      warned: 0,
    });
    expect((await admin<AdminLinkCounts>("/admin/links/counts?org=org-2", cookie)).all).toBe(0);
  });

  it("filters to open reports and to Google's verdicts", async () => {
    await freeOwnerCookie();
    await seedLinks();
    const cookie = await adminCookie();
    const ids = async (query: string) =>
      (await admin<AdminLinkRow[]>(`/admin/links?q=${query}`, cookie)).map((l) => l.id);
    expect(await ids("&reported=1")).toEqual(["link-c"]);
    // A DNS blocklist hit scores the same, and is not Google's.
    expect(await ids("&flagged=1&sort=risk")).toEqual(["link-a"]);
  });

  it("is a 404 for anyone but a platform admin", async () => {
    const cookie = await freeOwnerCookie();
    expect((await get("/admin/links/counts", cookie)).status).toBe(404);
  });
});

/* ─────────── plan changes in the audit log ─────────── */

const auditRows = (cookie: string) => admin<AdminActionRow[]>("/admin/audit", cookie);

const planChanges = (rows: AdminActionRow[]) => rows.filter((r) => r.action === "plan.change");

function signed(payload: string) {
  const timestamp = new Date();
  return {
    "webhook-id": "msg-plan-1",
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": new Webhook(btoa(POLAR_WEBHOOK_SECRET)).sign(
      "msg-plan-1",
      timestamp,
      payload,
    ),
  };
}

describe("plan.change", () => {
  it("logs Polar's change once, as Polar, from the plan to the plan", async () => {
    await freeOwnerCookie();
    const payload = JSON.stringify({
      type: "subscription.active",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "free-1" },
      },
    });
    const res = await fetchWorker(
      new Request("http://localhost/api/webhooks/polar", {
        method: "POST",
        headers: { "content-type": "application/json", ...signed(payload) },
        body: payload,
      }),
      { ...billingEnv(), BILLING: unreachableBilling },
    );
    expect(res.status).toBe(200);
    // A second pass over the same plan has nothing new to say.
    await reconcileUser(env, testDb(), "free-1");

    const [entry, ...rest] = planChanges(await auditRows(await adminCookie()));
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      actorUserId: "polar",
      targetType: "user",
      targetId: "free-1",
    });
    expect(JSON.parse(entry?.detail ?? "{}")).toEqual({
      from: "free",
      to: "pro",
      email: "free@example.com",
    });
  });

  it("logs nothing of its own for a comp, which has its own entry", async () => {
    await freeOwnerCookie();
    const cookie = await adminCookie();
    const res = await fetchWorker(
      new Request("http://localhost/api/admin/users/free-1/comp", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ plan: "hobby", reason: "Launch partner" }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await auditRows(cookie);
    expect(planChanges(rows)).toEqual([]);
    expect(rows.map((r) => r.action)).toContain("user.comp_grant");
  });

  it("catches up a change no pass logged, on the manual reconcile", async () => {
    await freeOwnerCookie();
    // A webhook that wrote the plan and never reconciled.
    await env.DB.prepare(
      "update user set plan = 'free', audited_plan = 'pro' where id = 'free-1'",
    ).run();
    const cookie = await adminCookie();
    await fetchWorker(
      new Request("http://localhost/api/admin/users/free-1/reconcile", {
        method: "POST",
        headers: { cookie },
      }),
    );
    const [entry] = planChanges(await auditRows(cookie));
    expect(JSON.parse(entry?.detail ?? "{}")).toMatchObject({ from: "pro", to: "free" });
  });
});
