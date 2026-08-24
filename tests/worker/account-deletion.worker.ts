/**
 * Deleting an account that owns organizations (#119).
 *
 * The guard in `hooks.before` refuses when an owned org still has other
 * members, and `beforeDelete` then recomputes and tears down the solo ones.
 * Two reads, one request apart, so an invite accepted in between turns a solo
 * org into a shared one after the refusal has already passed. The owner's
 * membership goes with the account by cascade, and the org is left with
 * members and no owner, which nothing in the product can express or repair.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import { deleteOrgs } from "../../src/worker/routes/orgs";
import { promoteLongestStandingMember } from "../../src/worker/plan";
import { applyTestMigrations, overrideEnv, testEnv } from "./support";

const ORG = "org-handover";
const LEAVING = "user-leaving";

afterEach(reset);

/** org_members.user_id is a foreign key, so every member needs a row. */
async function seedUser(id: string): Promise<void> {
  await env.DB.prepare(
    "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, 'Person', ?, 1, 0, 'free', 0, 0)",
  )
    .bind(id, `${id}@example.com`)
    .run();
}

beforeEach(async () => {
  await applyTestMigrations();
  await seedUser(LEAVING);
  await env.DB.batch([
    env.DB.prepare("insert into orgs (id, name, created_at) values (?, 'Shared Co', 0)").bind(ORG),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values (?, ?, 'owner', 100)",
    ).bind(ORG, LEAVING),
  ]);
});

async function addMember(userId: string, joinedAt: number, role = "member"): Promise<void> {
  await seedUser(userId);
  await env.DB.prepare(
    "insert into org_members (org_id, user_id, role, created_at) values (?, ?, ?, ?)",
  )
    .bind(ORG, userId, role, joinedAt)
    .run();
}

async function roleOf(userId: string): Promise<string | null> {
  const row = await env.DB.prepare("select role from org_members where org_id = ? and user_id = ?")
    .bind(ORG, userId)
    .first<{ role: string }>();
  return row?.role ?? null;
}

describe("promoteLongestStandingMember", () => {
  it("hands the org to whoever joined first, not whoever joined last", async () => {
    await addMember("user-early", 200);
    await addMember("user-late", 300);

    expect(await promoteLongestStandingMember(testEnv, ORG, LEAVING)).toBe(true);

    expect(await roleOf("user-early")).toBe("owner");
    expect(await roleOf("user-late")).toBe("member");
    // The leaving owner keeps their row until the cascade removes it: this
    // hands the org over, it does not evict anyone.
    expect(await roleOf(LEAVING)).toBe("owner");
  });

  it("promotes an admin the same way, since rank is not the tiebreaker", async () => {
    await addMember("user-early", 200, "member");
    await addMember("user-admin", 300, "admin");

    await promoteLongestStandingMember(testEnv, ORG, LEAVING);

    expect(await roleOf("user-early")).toBe("owner");
  });

  it("reports false for a genuinely solo org, which belongs to the teardown", async () => {
    expect(await promoteLongestStandingMember(testEnv, ORG, LEAVING)).toBe(false);
  });

  it("never promotes the person leaving", async () => {
    expect(await promoteLongestStandingMember(testEnv, ORG, LEAVING)).toBe(false);
    // Nobody else exists, so an org with one member cannot be handed on. The
    // teardown is what deals with it.
    const rows = await env.DB.prepare("select count(*) as n from org_members where org_id = ?")
      .bind(ORG)
      .first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it("leaves an org with no owner impossible after a member joins mid-deletion", async () => {
    // The race, played out: the guard saw a solo org, somebody accepted an
    // invite, and now the account is being deleted anyway.
    await addMember("user-joined-late", 400);
    await promoteLongestStandingMember(testEnv, ORG, LEAVING);
    await env.DB.prepare("delete from org_members where user_id = ?").bind(LEAVING).run();

    const owners = await env.DB.prepare(
      "select count(*) as n from org_members where org_id = ? and role = 'owner'",
    )
      .bind(ORG)
      .first<{ n: number }>();
    expect(owners!.n).toBe(1);
  });
});

describe("deleteOrgs", () => {
  function workflow(fail = false) {
    const started: string[] = [];
    const binding: typeof env.ORG_DELETE = {
      async create() {
        throw new Error("teardown starts with createBatch");
      },
      async get() {
        throw new Error("instance not found");
      },
      async createBatch(batch) {
        if (fail) throw new Error("injected workflow start failure");
        started.push(...batch.map((entry) => entry.id ?? ""));
        return [];
      },
      async deleteBatch() {
        throw new Error("teardown never deletes a batch");
      },
    };
    return { binding, started };
  }

  const deletingIds = async (): Promise<string[]> => {
    const rows = await env.DB.prepare(
      "select id from orgs where deleting_at is not null order by id",
    ).all<{ id: string }>();
    return rows.results.map((r) => r.id);
  };

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('org-a', 'A', 0)"),
      env.DB.prepare("insert into orgs (id, name, created_at) values ('org-b', 'B', 0)"),
    ]);
  });

  it("marks and starts every org in one pass", async () => {
    const { binding, started } = workflow();
    await deleteOrgs(drizzle(env.DB, { schema }), overrideEnv({ ORG_DELETE: binding }), [
      "org-a",
      "org-b",
    ]);

    expect(started).toEqual(["org-a", "org-b"]);
    expect(await deletingIds()).toEqual(["org-a", "org-b"]);
  });

  it("does nothing at all when the set is empty", async () => {
    const { binding, started } = workflow();
    await deleteOrgs(drizzle(env.DB, { schema }), overrideEnv({ ORG_DELETE: binding }), []);
    expect(started).toEqual([]);
    expect(await deletingIds()).toEqual([]);
  });

  it("leaves no org half torn down when the start fails", async () => {
    const { binding } = workflow(true);
    await expect(
      deleteOrgs(drizzle(env.DB, { schema }), overrideEnv({ ORG_DELETE: binding }), [
        "org-a",
        "org-b",
      ]),
    ).rejects.toThrow("injected workflow start failure");

    // One start for the whole set, so this is all-or-nothing rather than
    // "the first two went and the third did not". The flags stay set because
    // the lookup cannot prove nothing is running; the next call restarts.
    expect(await deletingIds()).toEqual(["org-a", "org-b"]);
  });
});
