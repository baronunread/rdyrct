/**
 * Deleting an account that owns organizations (#119).
 *
 * The account and its owned-org flags change in one D1 batch, before any
 * teardown starts. That keeps a later account-delete failure from leaving a
 * live account whose organizations are already being destroyed, and keeps a
 * membership race from leaving an ownerless org.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errors } from "@polar-sh/sdk/2026-04";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import { deleteOrgs } from "../../src/worker/routes/orgs";
import { deleteAccountAndOwnedOrgs } from "../../src/worker/better-auth";
import type { BillingProvider } from "../../src/worker/billing-provider";
import { applyTestMigrations, overrideEnv } from "./support";

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

/** A teardown binding that records the ids it was asked to start. `fail`
 * makes the start throw, which is the ambiguous case deleteOrgs fails closed
 * on. */
function fakeTeardown(fail = false) {
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

describe("deleteAccountAndOwnedOrgs", () => {
  /** Deletes the leaving account against a teardown binding the test controls. */
  const removeAccount = (binding: typeof env.ORG_DELETE) =>
    deleteAccountAndOwnedOrgs(overrideEnv({ ORG_DELETE: binding }), LEAVING);

  const userExists = async (): Promise<boolean> => {
    const row = await env.DB.prepare("select count(*) as n from user where id = ?")
      .bind(LEAVING)
      .first<{ n: number }>();
    return row!.n === 1;
  };

  const deletingAt = (orgId: string): Promise<{ deleting_at: number | null } | null> =>
    env.DB.prepare("select deleting_at from orgs where id = ?")
      .bind(orgId)
      .first<{ deleting_at: number | null }>();

  it("takes every organization the account owns, teammates or not", async () => {
    // The org has no plan of its own: orgPlan reads its owner's. Leaving a
    // shared one behind gives it no plan, no billing and nobody who can
    // delete it, so the account cannot be deleted without it.
    await addMember("user-stayer", 200);
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('solo', 'Solo', 0)"),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('solo', ?, 'owner', 0)",
      ).bind(LEAVING),
    ]);
    const { binding, started } = fakeTeardown();

    await removeAccount(binding);

    expect(started.sort()).toEqual([ORG, "solo"]);
    expect(await userExists()).toBe(false);
    expect((await deletingAt(ORG))!.deleting_at).not.toBeNull();
    expect((await deletingAt("solo"))!.deleting_at).not.toBeNull();
  });

  it("leaves an org this account only belongs to", async () => {
    // Membership is not ownership: someone else's org survives.
    await seedUser("user-other-owner");
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('theirs', 'Theirs', 0)"),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('theirs', 'user-other-owner', 'owner', 0)",
      ),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('theirs', ?, 'member', 0)",
      ).bind(LEAVING),
    ]);
    const { binding, started } = fakeTeardown();

    await removeAccount(binding);

    expect(started).toEqual([ORG]);
    expect((await deletingAt("theirs"))!.deleting_at).toBeNull();
  });

  it("rolls the org flags back when deleting the account fails", async () => {
    // The old hook started teardown first. A later user-delete failure then
    // left the account alive while its org disappeared. This trigger holds
    // that failure still and proves both D1 writes share one transaction.
    await env.DB.prepare(
      `create trigger refuse_account_delete before delete on user
       when old.id = '${LEAVING}' begin select raise(abort, 'injected delete failure'); end`,
    ).run();
    const { binding, started } = fakeTeardown();

    await expect(removeAccount(binding)).rejects.toThrow("injected delete failure");

    expect(started).toEqual([]);
    expect(await userExists()).toBe(true);
    expect((await deletingAt(ORG))!.deleting_at).toBeNull();
  });

  it("keeps the durable flag when the workflow start fails", async () => {
    const { binding, started } = fakeTeardown(true);

    await removeAccount(binding);

    expect(started).toEqual([]);
    expect(await userExists()).toBe(false);
    expect((await deletingAt(ORG))!.deleting_at).not.toBeNull();
  });
});

describe("deleteAccountAndOwnedOrgs with a Polar subscription", () => {
  const SUBSCRIPTION = "sub_paying";

  /** A billing client whose only real method is revoke, so a test sees each
   * call and decides how Polar answers it. */
  function fakeBilling(answer: () => Promise<{ id: string }>) {
    const revoke = vi.fn(answer);
    const billing: BillingProvider = {
      checkouts: {
        async create() {
          throw new Error("deletion never checks out");
        },
        async get() {
          throw new Error("deletion never reads a checkout");
        },
      },
      customerSessions: {
        async create() {
          throw new Error("deletion never opens the portal");
        },
      },
      subscriptions: { revoke },
    };
    return { billing, revoke };
  }

  const removeAccount = (billing: BillingProvider) =>
    deleteAccountAndOwnedOrgs(
      overrideEnv({ ORG_DELETE: fakeTeardown().binding, BILLING: billing }),
      LEAVING,
    );

  const userExists = async (): Promise<boolean> =>
    (await env.DB.prepare("select id from user where id = ?").bind(LEAVING).first()) !== null;

  beforeEach(async () => {
    await env.DB.prepare("update user set plan = 'pro', polar_subscription_id = ? where id = ?")
      .bind(SUBSCRIPTION, LEAVING)
      .run();
  });

  it("revokes the subscription, then deletes the account", async () => {
    const { billing, revoke } = fakeBilling(async () => ({ id: SUBSCRIPTION }));

    await removeAccount(billing);

    expect(revoke).toHaveBeenCalledWith(SUBSCRIPTION);
    expect(await userExists()).toBe(false);
  });

  it("keeps the account when Polar does not confirm the revoke", async () => {
    // A deleted account leaves no row for a later webhook to match, so the
    // only safe answer to an unreachable Polar is to delete nothing.
    const { billing } = fakeBilling(async () => {
      throw new Error("injected Polar outage");
    });

    await expect(removeAccount(billing)).rejects.toThrow("Could not cancel the subscription");

    expect(await userExists()).toBe(true);
    const org = await env.DB.prepare("select deleting_at from orgs where id = ?")
      .bind(ORG)
      .first<{ deleting_at: number | null }>();
    expect(org!.deleting_at).toBeNull();
  });

  it.each([
    new errors.ResourceNotFound(404, { error: "ResourceNotFound", detail: "Not found" }),
    new errors.AlreadyCanceledSubscription(403, {
      error: "AlreadyCanceledSubscription",
      detail: "Already canceled",
    }),
  ])("deletes the account when Polar answers $name", async (ended) => {
    const { billing } = fakeBilling(async () => {
      throw ended;
    });

    await removeAccount(billing);

    expect(await userExists()).toBe(false);
  });

  it("skips Polar for an account with no subscription", async () => {
    await env.DB.prepare("update user set polar_subscription_id = null where id = ?")
      .bind(LEAVING)
      .run();
    const { billing, revoke } = fakeBilling(async () => ({ id: SUBSCRIPTION }));

    await removeAccount(billing);

    expect(revoke).not.toHaveBeenCalled();
    expect(await userExists()).toBe(false);
  });
});

describe("deleteOrgs", () => {
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
    const { binding, started } = fakeTeardown();
    await deleteOrgs(drizzle(env.DB, { schema }), overrideEnv({ ORG_DELETE: binding }), [
      "org-a",
      "org-b",
    ]);

    expect(started).toEqual(["org-a", "org-b"]);
    expect(await deletingIds()).toEqual(["org-a", "org-b"]);
  });

  it("does nothing at all when the set is empty", async () => {
    const { binding, started } = fakeTeardown();
    await deleteOrgs(drizzle(env.DB, { schema }), overrideEnv({ ORG_DELETE: binding }), []);
    expect(started).toEqual([]);
    expect(await deletingIds()).toEqual([]);
  });

  it("leaves no org half torn down when the start fails", async () => {
    const { binding } = fakeTeardown(true);
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
