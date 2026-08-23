import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { eq } from "drizzle-orm";
import * as schema from "../../src/worker/db/schema";
import { reconcileUser, sweepGraceWarnings } from "../../src/worker/reconcile";
import { GRACE_PERIOD_MS } from "../../src/shared/types";
import {
  applyTestMigrations,
  captureEmails,
  captureStorageQueue,
  overrideEnv,
  testDb,
} from "./support";

/**
 * Reconciliation (#158): what a plan change does to the orgs a user owns.
 *
 * Every case here is a downgrade the product used to ignore entirely, plus
 * the two properties the whole design rests on: running the pass twice
 * changes nothing, and re-upgrading undoes all of it with no manual step.
 */

const NOW = 1_700_000_000_000;

/** An owner on `plan`, owning `orgs` orgs oldest-first, each with the given
 * number of extra members and domains. */
async function seed({
  plan = "pro",
  orgs = 1,
  members = 0,
  domains = 0,
}: { plan?: string; orgs?: number; members?: number; domains?: number } = {}) {
  const statements = [
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('owner-1', 'Owner', 'owner@example.com', 1, 0, ?, 0, 0)",
    ).bind(plan),
  ];
  for (let i = 0; i < orgs; i++) {
    const orgId = `org-${i}`;
    statements.push(
      env.DB.prepare("insert into orgs (id, name, created_at) values (?, ?, ?)").bind(
        orgId,
        `Org ${i}`,
        i,
      ),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values (?, 'owner-1', 'owner', 0)",
      ).bind(orgId),
    );
  }
  for (let i = 0; i < members; i++) {
    statements.push(
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, ?, ?, 1, 0, 'free', 0, 0)",
      ).bind(`member-${i}`, `Member ${i}`, `member${i}@example.com`),
      // created_at ascending, so "longest-standing keeps write access" has an
      // order to be right about.
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('org-0', ?, 'member', ?)",
      ).bind(`member-${i}`, i + 1),
    );
  }
  for (let i = 0; i < domains; i++) {
    statements.push(
      env.DB.prepare(
        "insert into domains (id, org_id, hostname, status, created_at) values (?, 'org-0', ?, 'active', ?)",
      ).bind(`dom-${i}`, `d${i}.example.com`, i),
    );
  }
  await env.DB.batch(statements);
}

async function setPlan(plan: string) {
  await env.DB.prepare("update user set plan = ? where id = 'owner-1'").bind(plan).run();
}

/** An env whose storage queue records instead of delivering, and whose mail
 * goes nowhere: both fire on every downgrade. */
function quietEnv() {
  const { queue, sent } = captureStorageQueue();
  return { env: overrideEnv({ STORAGE_QUEUE: queue }), storage: sent };
}

async function entitlement(orgId = "org-0") {
  const [row] = await testDb()
    .select()
    .from(schema.orgEntitlements)
    .where(eq(schema.orgEntitlements.orgId, orgId));
  return row;
}

async function members() {
  return testDb()
    .select()
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.orgId, "org-0"))
    .orderBy(schema.orgMembers.createdAt);
}

async function domains() {
  return testDb().select().from(schema.domains).orderBy(schema.domains.createdAt);
}

async function orgLocks() {
  return testDb().select().from(schema.orgs).orderBy(schema.orgs.createdAt);
}

describe("entitlement reconciliation", () => {
  beforeEach(async () => {
    await reset();
    await applyTestMigrations();
  });

  it("records nothing for an org inside its plan", async () => {
    await seed({ plan: "free" });
    const { env: e } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);
    const row = await entitlement();
    expect(row.overJson).toBe("{}");
    expect(row.graceEndsAt).toBeNull();
  });

  it("locks the domains beyond the cap on hobby-to-free, oldest kept", async () => {
    await seed({ plan: "hobby", domains: 2 });
    const { env: e, storage } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);
    // Hobby allows one domain: the older one keeps serving.
    expect((await domains()).map((d) => d.lockedAt)).toEqual([null, NOW]);

    await setPlan("free");
    await reconcileUser(e, testDb(), "owner-1", NOW);
    expect((await domains()).map((d) => d.lockedAt)).toEqual([NOW, NOW]);
    const row = await entitlement();
    expect(JSON.parse(row.overJson)).toEqual({ domains: 2 });
    expect(row.graceEndsAt).toBe(NOW + GRACE_PERIOD_MS);
    // Only the domains whose verdict moved get a KV republish.
    expect(storage.map((m) => ("key" in m ? m.key : ""))).toContain("domain:d0.example.com");
  });

  it("demotes over-cap members to viewer, longest-standing first, owner exempt", async () => {
    // Pro allows 25; free allows 3 (owner + 2).
    await seed({ plan: "pro", members: 4 });
    await setPlan("free");
    const { env: e } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);

    const rows = await members();
    expect(rows.map((r) => [r.userId, r.role])).toEqual([
      ["owner-1", "owner"],
      ["member-0", "member"],
      ["member-1", "member"],
      ["member-2", "viewer"],
      ["member-3", "viewer"],
    ]);
    // What they were is recorded, and only for the ones that moved.
    expect(rows.map((r) => r.previousRole)).toEqual([null, null, null, "member", "member"]);
    expect(JSON.parse((await entitlement()).overJson)).toEqual({ members: 5 });
  });

  it("locks the extra orgs on pro-to-free, keeping the oldest", async () => {
    await seed({ plan: "pro", orgs: 3 });
    await setPlan("free");
    const { env: e } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);
    expect((await orgLocks()).map((o) => o.lockedAt)).toEqual([null, NOW, NOW]);
  });

  it("changes nothing when run twice for the same plan", async () => {
    await seed({ plan: "pro", orgs: 3, members: 4, domains: 3 });
    await setPlan("free");
    const { env: e } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);
    const first = await entitlement();

    // A day later, same plan: the grace period must not move.
    await reconcileUser(e, testDb(), "owner-1", NOW + 86_400_000);
    const second = await entitlement();
    expect(second.graceEndsAt).toBe(first.graceEndsAt);
    expect(second.overJson).toBe(first.overJson);
    expect((await orgLocks()).map((o) => o.lockedAt)).toEqual([null, NOW, NOW]);
    expect((await domains()).map((d) => d.lockedAt)).toEqual([NOW, NOW, NOW]);
    expect((await members()).map((r) => r.role)).toEqual([
      "owner",
      "member",
      "member",
      "viewer",
      "viewer",
    ]);
  });

  it("restores everything on upgrade, with no manual step", async () => {
    await seed({ plan: "pro", orgs: 3, members: 4, domains: 3 });
    await setPlan("free");
    const { env: e } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);

    await setPlan("pro");
    await reconcileUser(e, testDb(), "owner-1", NOW + 1000);

    expect((await orgLocks()).map((o) => o.lockedAt)).toEqual([null, null, null]);
    expect((await domains()).map((d) => d.lockedAt)).toEqual([null, null, null]);
    const rows = await members();
    expect(rows.map((r) => r.role)).toEqual(["owner", "member", "member", "member", "member"]);
    expect(rows.every((r) => r.previousRole === null)).toBe(true);
    const row = await entitlement();
    expect(row.overJson).toBe("{}");
    expect(row.graceEndsAt).toBeNull();
  });

  it("restarts the grace period when the plan drops again", async () => {
    await seed({ plan: "pro", domains: 3 });
    await setPlan("hobby");
    const { env: e } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);
    expect((await entitlement()).graceEndsAt).toBe(NOW + GRACE_PERIOD_MS);

    const later = NOW + 40 * 86_400_000;
    await setPlan("free");
    await reconcileUser(e, testDb(), "owner-1", later);
    // The domain that only just went over must not inherit an expired clock.
    expect((await entitlement()).graceEndsAt).toBe(later + GRACE_PERIOD_MS);
  });

  it("emails the owner once per grace period, then warns at day 23", async () => {
    await seed({ plan: "hobby", domains: 2 });
    await setPlan("free");
    const mail = captureEmails();
    try {
      const { env: e } = quietEnv();
      await reconcileUser(e, testDb(), "owner-1", NOW);
      expect(mail.sent.map((m) => m.to)).toEqual(["owner@example.com"]);
      expect(mail.sent[0].subject).toContain("over its plan");

      // A second pass on the same plan sends nothing more.
      await reconcileUser(e, testDb(), "owner-1", NOW + 1000);
      expect(mail.sent).toHaveLength(1);

      // Day 23 of 30: one week left.
      const day23 = NOW + GRACE_PERIOD_MS - 6 * 86_400_000;
      expect(await sweepGraceWarnings(e, testDb(), day23)).toBe(1);
      expect(mail.sent).toHaveLength(2);
      expect(mail.sent[1].subject).toContain("loses its custom domains soon");
      // And only once.
      expect(await sweepGraceWarnings(e, testDb(), day23 + 1000)).toBe(0);
    } finally {
      mail.restore();
    }
  });

  it("leaves a grace with more than a week left alone", async () => {
    await seed({ plan: "hobby", domains: 2 });
    await setPlan("free");
    const mail = captureEmails();
    try {
      const { env: e } = quietEnv();
      await reconcileUser(e, testDb(), "owner-1", NOW);
      expect(await sweepGraceWarnings(e, testDb(), NOW + 86_400_000)).toBe(0);
    } finally {
      mail.restore();
    }
  });
});
