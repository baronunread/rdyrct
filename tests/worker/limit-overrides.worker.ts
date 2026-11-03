import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { orgPlan } from "../../src/worker/plan";
import { saveLimitOverrides } from "../../src/worker/limit-overrides";
import {
  adminCookie,
  applyTestMigrations,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  seedFillerLinks,
  testDb,
} from "./support";
import { PLAN_LIMITS, type CurrentUser, type JsonValue } from "../../src/shared/types";

/**
 * Custom limits per account: a platform admin may raise any limit for one
 * user by hand (Enterprise). The effective value of each limit is the higher
 * of the plan's and the override, and migration 0051 grandfathers whoever
 * already owned several orgs.
 */

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});
afterEach(reset);

const call = (cookie: string, method: string, path: string, body?: JsonValue) =>
  fetchWorker(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

/** The stored rows for a user, by key. */
const rowsOf = async (userId: string) =>
  (
    await env.DB.prepare(
      "select limit_key, value, note, set_by from limit_overrides where user_id = ? order by limit_key",
    )
      .bind(userId)
      .all<{ limit_key: string; value: number; note: string | null; set_by: string | null }>()
  ).results;

const setPlan = (plan: string) =>
  env.DB.prepare("update user set plan = ? where id = 'free-1'").bind(plan).run();

describe("migration 0051 grandfathers multi-org owners", () => {
  /** The migration's data statements, less the CREATE TABLE: the table is already there. */
  async function replay() {
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0051"));
    expect(migration, "migration 0051 is missing from the test bundle").toBeTruthy();
    await env.DB.batch(
      migration!.queries
        .filter((query) => !query.includes("CREATE TABLE"))
        .map((query) => env.DB.prepare(query)),
    );
  }

  const owner = (id: string) =>
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, ?, ?, 1, 0, 'pro', 0, 0)",
    ).bind(id, id, `${id}@example.com`);
  const org = (id: string, ownerId: string, state: "locked_at" | "deleting_at" | null = null) => [
    env.DB.prepare(
      `insert into orgs (id, name, created_at${state ? `, ${state}` : ""}) values (?, ?, 0${state ? ", 5" : ""})`,
    ).bind(id, id),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values (?, ?, 'owner', 0)",
    ).bind(id, ownerId),
  ];

  it("is a no-op on a database with no owners", async () => {
    await replay();
    expect(await env.DB.prepare("select count(*) as n from limit_overrides").first()).toEqual({
      n: 0,
    });
  });

  it("writes an orgs row for an owner of several unlocked orgs, and nothing for anyone else", async () => {
    await env.DB.batch([
      owner("two"),
      ...org("two-a", "two"),
      ...org("two-b", "two"),
      owner("one"),
      ...org("one-a", "one"),
      owner("mixed"),
      ...org("mixed-a", "mixed"),
      ...org("mixed-locked", "mixed", "locked_at"),
      ...org("mixed-deleting", "mixed", "deleting_at"),
    ]);
    await replay();
    expect(await rowsOf("two")).toEqual([
      {
        limit_key: "orgs",
        value: 2,
        note: "Grandfathered: owned 2 organizations before Pro covered one",
        set_by: null,
      },
    ]);
    expect(await rowsOf("one")).toEqual([]);
    // One unlocked org, one locked, one being deleted: only the first counts.
    expect(await rowsOf("mixed")).toEqual([]);
  });
});

describe("effective limits", () => {
  it("only raise: Pro's 3000 links stay with an override of 500, and 10000 allows 10000", async () => {
    await freeOwnerCookie();
    await setPlan("pro");
    const links = async () => (await orgPlan(testDb(), "org-1")).limits.links;

    await saveLimitOverrides(testDb(), "free-1", { links: 500 });
    expect(await links()).toBe(PLAN_LIMITS.pro.links);
    await saveLimitOverrides(testDb(), "free-1", { links: 10_000 });
    expect(await links()).toBe(10_000);
  });

  it("resolve every key for the owner's orgs, and the app is sent them", async () => {
    const cookie = await freeOwnerCookie();
    await setPlan("hobby");
    await saveLimitOverrides(testDb(), "free-1", {
      orgs: 4,
      members: 10,
      domains: 2,
      analyticsDays: 90,
      trackedClicks: 90_000,
      qrCustom: true,
    });
    const { limits } = (await orgPlan(testDb(), "org-1")) ?? {};
    expect(limits).toMatchObject({
      orgs: 4,
      members: 10,
      domains: 2,
      analyticsDays: 90,
      trackedClicks: 90_000,
      qrCustom: true,
      // Not overridden: the plan's own.
      links: PLAN_LIMITS.hobby.links,
    });
    const me = await jsonBody<CurrentUser>(await call(cookie, "GET", "/user"));
    expect(me.orgs[0]?.limits).toEqual(limits);
    expect(me.user.limits.orgs).toBe(4);
  });

  it("read rows that are not valid overrides as the plan's limits", async () => {
    await freeOwnerCookie();
    await setPlan("pro");
    for (const [key, value] of [
      ["links", 0],
      ["links", -5],
      ["qr_custom", 5],
    ] as const) {
      await env.DB.prepare("delete from limit_overrides").run();
      await env.DB.prepare(
        "insert into limit_overrides (user_id, limit_key, value, set_at) values ('free-1', ?, ?, 0)",
      )
        .bind(key, value)
        .run();
      expect((await orgPlan(testDb(), "org-1")).limits).toEqual(PLAN_LIMITS.pro);
    }
  });

  it("ignore the overrides on Free, and keep them for the next paid plan", async () => {
    await freeOwnerCookie();
    await saveLimitOverrides(testDb(), "free-1", { links: 9_000, orgs: 3 });
    expect((await orgPlan(testDb(), "org-1")).limits).toEqual(PLAN_LIMITS.free);
    await setPlan("pro");
    expect((await orgPlan(testDb(), "org-1")).limits).toMatchObject({ links: 9_000, orgs: 3 });
  });
});

describe("the limits on the routes that enforce them", () => {
  async function proOwner() {
    const cookie = await freeOwnerCookie();
    await setPlan("pro");
    return cookie;
  }

  it("refuses a second org on Pro with no override, with code org_limit", async () => {
    const cookie = await proOwner();
    const res = await call(cookie, "POST", "/orgs", { name: "Second" });
    expect(res.status).toBe(402);
    expect(await jsonBody<{ code?: string }>(res)).toMatchObject({ code: "org_limit" });
  });

  it("allows orgs up to an override of three", async () => {
    const cookie = await proOwner();
    await saveLimitOverrides(testDb(), "free-1", { orgs: 3 });
    expect((await call(cookie, "POST", "/orgs", { name: "Second" })).status).toBe(201);
    expect((await call(cookie, "POST", "/orgs", { name: "Third" })).status).toBe(201);
    expect((await call(cookie, "POST", "/orgs", { name: "Fourth" })).status).toBe(402);
  });

  it("allows links up to a custom count, and no more", async () => {
    const cookie = await freeOwnerCookie();
    await setPlan("hobby");
    await saveLimitOverrides(testDb(), "free-1", { links: PLAN_LIMITS.hobby.links + 2 });
    await seedFillerLinks(testDb(), "org-1", PLAN_LIMITS.hobby.links, "f");

    const create = () =>
      call(cookie, "POST", "/orgs/org-1/links", {
        destination: `https://example.com/${Math.random()}`,
      });
    // The plan's links are used: the next two fit the custom count, the third does not.
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(402);
  });
});

/** The free-1 account, owning three orgs. */
async function ownerOfThreeOrgs() {
  await freeOwnerCookie();
  await env.DB.batch([
    env.DB.prepare(
      "insert into orgs (id, name, created_at) values ('org-2', 'Two', 1), ('org-3', 'Three', 2)",
    ),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-2', 'free-1', 'owner', 0), ('org-3', 'free-1', 'owner', 0)",
    ),
  ]);
}

/** The ids of the orgs that are read-only. */
const locked = async () =>
  (
    await env.DB.prepare("select id from orgs where locked_at is not null order by id").all<{
      id: string;
    }>()
  ).results.map((r) => r.id);

describe("PUT /api/admin/users/:id/limits", () => {
  const put = (cookie: string, userId: string, overrides: JsonValue, note?: string) =>
    call(
      cookie,
      "PUT",
      `/admin/users/${userId}/limits`,
      note === undefined ? { overrides } : { overrides, note },
    );

  it("answers 404 to anyone but a platform admin", async () => {
    const cookie = await freeOwnerCookie();
    expect((await put(cookie, "free-1", { orgs: 5 })).status).toBe(404);
    expect(await rowsOf("free-1")).toEqual([]);
  });

  it("sets, audits and clears", async () => {
    await freeOwnerCookie();
    const cookie = await adminCookie();
    expect(
      (await put(cookie, "free-1", { orgs: 3, links: 100, qrCustom: true }, "Acme, $199/mo"))
        .status,
    ).toBe(200);
    expect(await rowsOf("free-1")).toEqual([
      { limit_key: "links", value: 100, note: "Acme, $199/mo", set_by: "admin-1" },
      { limit_key: "orgs", value: 3, note: "Acme, $199/mo", set_by: "admin-1" },
      { limit_key: "qr_custom", value: 1, note: "Acme, $199/mo", set_by: "admin-1" },
    ]);
    // A second save replaces the rows, it does not add to them.
    await put(cookie, "free-1", { links: 200, orgs: 3, qrCustom: true }, "Acme, $199/mo");
    expect((await rowsOf("free-1")).map((r) => r.value)).toEqual([200, 3, 1]);
    const audit = await env.DB.prepare(
      "select target_id, detail from admin_actions where action = 'user.limits'",
    ).first<{ target_id: string; detail: string }>();
    expect(audit?.target_id).toBe("free-1");
    expect(JSON.parse(audit!.detail)).toMatchObject({ note: "Acme, $199/mo" });

    const users = await jsonBody<
      {
        id: string;
        limitOverrides: object | null;
        limitNote: string | null;
        limitSetBy: string | null;
      }[]
    >(await call(cookie, "GET", "/admin/users"));
    expect(users.find((u) => u.id === "free-1")).toMatchObject({
      limitOverrides: { orgs: 3, links: 200, qrCustom: true },
      limitNote: "Acme, $199/mo",
      limitSetBy: "admin@example.com",
    });

    expect((await put(cookie, "free-1", null)).status).toBe(200);
    expect(await rowsOf("free-1")).toEqual([]);
    // An empty object is the same as none.
    await put(cookie, "free-1", { orgs: 2 });
    await put(cookie, "free-1", {});
    expect(await rowsOf("free-1")).toEqual([]);
  });

  it("refuses values that are not whole numbers in range, unknown keys, and unknown users", async () => {
    const cookie = await adminCookie();
    const bad: JsonValue[] = [
      { orgs: 0 },
      { orgs: -1 },
      { links: 1.5 },
      { members: "3" },
      { orgs: 100_000 },
      { qrCustom: "yes" },
      { linkz: 5 },
    ];
    for (const overrides of bad)
      expect((await put(cookie, "admin-1", overrides)).status, JSON.stringify(overrides)).toBe(400);
    expect((await put(cookie, "nobody", { orgs: 2 })).status).toBe(404);
    expect(await rowsOf("admin-1")).toEqual([]);
    expect((await put(cookie, "admin-1", { orgs: 2 }, "x".repeat(201))).status).toBe(400);
  });

  it("reconciles: removing the override locks the extra orgs, adding it unlocks them", async () => {
    await ownerOfThreeOrgs();
    await setPlan("pro");
    const cookie = await adminCookie();

    await put(cookie, "free-1", { orgs: 2 });
    expect(await locked()).toEqual(["org-3"]);
    await put(cookie, "free-1", { orgs: 3 });
    expect(await locked()).toEqual([]);
    await put(cookie, "free-1", null);
    expect(await locked()).toEqual(["org-2", "org-3"]);
  });

  it("applies only on a paid plan: a comp that ends locks the account down, and a new one restores it", async () => {
    await ownerOfThreeOrgs();
    const cookie = await adminCookie();
    const comp = (method: "POST" | "DELETE") =>
      call(
        cookie,
        method,
        "/admin/users/free-1/comp",
        method === "POST" ? { plan: "pro", reason: "test" } : undefined,
      );

    // Free ignores the override: saving it changes nothing for the account.
    await put(cookie, "free-1", { orgs: 3 });
    expect(await locked()).toEqual(["org-2", "org-3"]);

    expect((await comp("POST")).status).toBe(200);
    expect(await locked()).toEqual([]);

    expect((await comp("DELETE")).status).toBe(200);
    expect(await locked()).toEqual(["org-2", "org-3"]);
    // The rows were never touched.
    expect((await rowsOf("free-1")).map((r) => [r.limit_key, r.value])).toEqual([["orgs", 3]]);

    expect((await comp("POST")).status).toBe(200);
    expect(await locked()).toEqual([]);
  });

  it("calls a comped account with custom limits Enterprise, and Free once the comp ends", async () => {
    const owner = await freeOwnerCookie();
    const cookie = await adminCookie();
    const tiers = async () => {
      const me = await jsonBody<CurrentUser>(await call(owner, "GET", "/user"));
      return [me.user.tier, ...me.orgs.map((o) => o.tier)];
    };
    expect(await tiers()).toEqual(["free", "free"]);

    await call(cookie, "POST", "/admin/users/free-1/comp", { plan: "pro", reason: "test" });
    expect(await tiers()).toEqual(["pro", "pro"]);

    await put(cookie, "free-1", { orgs: 3 });
    expect(await tiers()).toEqual(["enterprise", "enterprise"]);

    await call(cookie, "DELETE", "/admin/users/free-1/comp");
    expect(await tiers()).toEqual(["free", "free"]);
    // Saved, not counted.
    expect((await rowsOf("free-1")).length).toBe(1);
  });
});
