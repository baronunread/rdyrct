import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { eq } from "drizzle-orm";
import * as schema from "../../src/worker/db/schema";
import { reconcileUser, sweepGraceWarnings } from "../../src/worker/reconcile";
import { saveLimitOverrides } from "../../src/worker/limit-overrides";
import type { StorageMessage } from "../../src/worker/storage";
import { GRACE_PERIOD_MS } from "../../src/shared/types";
import {
  applyTestMigrations,
  captureEmails,
  captureStorage,
  failingKv,
  overrideEnv,
  stubQueue,
  testDb,
} from "./support";

const NOW = 1_700_000_000_000;

async function seed({
  plan = "pro",
  orgs = 1,
  members = 0,
  domains = 0,
  orgLimit = null,
}: {
  plan?: string;
  orgs?: number;
  members?: number;
  domains?: number;
  orgLimit?: number | null;
} = {}) {
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
  await setOrgs(orgLimit);
}

async function setOrgs(limit: number | null) {
  await saveLimitOverrides(testDb(), "owner-1", limit === null ? null : { orgs: limit });
}

async function setPlan(plan: string) {
  await env.DB.prepare("update user set plan = ? where id = 'owner-1'").bind(plan).run();
}

/**
 * Mail is not stubbed here: `reconcileUser` swallows send failures, so cases
 * asserting D1 and KV need not care. The email cases use `withMail`.
 */
function quietEnv() {
  const { env: captured, sent } = captureStorage();
  return { env: overrideEnv(captured), storage: sent };
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

async function downgrade(
  seedArgs: Parameters<typeof seed>[0],
  to: string,
  now = NOW,
): Promise<ReturnType<typeof quietEnv>> {
  await seed(seedArgs);
  await setPlan(to);
  const quiet = quietEnv();
  await reconcileUser(quiet.env, testDb(), "owner-1", now);
  return quiet;
}

async function withMail(body: (mail: ReturnType<typeof captureEmails>) => Promise<void>) {
  const mail = captureEmails();
  try {
    await body(mail);
  } finally {
    mail.restore();
  }
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
    expect((await domains()).map((d) => d.lockedAt)).toEqual([null, NOW]);

    await setPlan("free");
    await reconcileUser(e, testDb(), "owner-1", NOW);
    expect((await domains()).map((d) => d.lockedAt)).toEqual([NOW, NOW]);
    const row = await entitlement();
    expect(JSON.parse(row.overJson)).toEqual({ domains: 2 });
    expect(row.graceEndsAt).toBe(NOW + GRACE_PERIOD_MS);
    expect(storage.map((m) => ("key" in m ? m.key : ""))).toContain("domain:d0.example.com");
  });

  it("requeues locked domains after a storage queue failure", async () => {
    await seed({ plan: "free", domains: 2 });
    const failing = overrideEnv({
      // KV refuses the in-request write and the queue refuses the fallback.
      LINKS: failingKv(),
      STORAGE_QUEUE: stubQueue<StorageMessage>(() => {
        throw new Error("injected storage queue failure");
      }),
    });

    // D1 commits before queue submission, exactly as it does for a transient
    // binding failure in production. The first pass therefore leaves both
    // domains locked while no KV sync was accepted.
    await reconcileUser(failing, testDb(), "owner-1", NOW);
    expect((await domains()).map((domain) => domain.lockedAt)).toEqual([NOW, NOW]);

    const { env: retry, storage } = quietEnv();
    await reconcileUser(retry, testDb(), "owner-1", NOW + 1_000);

    // Nothing in D1 changes on the replay, but it still republishes all
    // locked hosts so their KV `servesUntil` values recover.
    expect(storage.map((message) => ("key" in message ? message.key : "")).sort()).toEqual([
      "domain:d0.example.com",
      "domain:d1.example.com",
    ]);
  });

  it("demotes over-cap members to viewer, longest-standing first, owner exempt", async () => {
    await downgrade({ plan: "pro", members: 4 }, "free");

    const rows = await members();
    expect(rows.map((r) => [r.userId, r.role])).toEqual([
      ["owner-1", "owner"],
      ["member-0", "member"],
      ["member-1", "member"],
      ["member-2", "viewer"],
      ["member-3", "viewer"],
    ]);
    expect(rows.map((r) => r.previousRole)).toEqual([null, null, null, "member", "member"]);
    expect(JSON.parse((await entitlement()).overJson)).toEqual({ members: 5 });
  });

  it("locks the extra orgs on pro-to-free, keeping the oldest", async () => {
    await downgrade({ plan: "pro", orgs: 3 }, "free");
    expect((await orgLocks()).map((o) => o.lockedAt)).toEqual([null, NOW, NOW]);
  });

  it("counts the admin's org allowance when it is higher than the plan's", async () => {
    await seed({ plan: "pro", orgs: 3, orgLimit: 2 });
    const { env: e } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);
    expect((await orgLocks()).map((o) => o.lockedAt)).toEqual([null, null, NOW]);

    await setOrgs(3);
    await reconcileUser(e, testDb(), "owner-1", NOW + 1);
    expect((await orgLocks()).map((o) => o.lockedAt)).toEqual([null, null, null]);
    await setOrgs(null);
    await reconcileUser(e, testDb(), "owner-1", NOW + 2);
    expect((await orgLocks()).map((o) => o.lockedAt)).toEqual([null, NOW + 2, NOW + 2]);
  });

  it("ignores an allowance lower than the plan's cap", async () => {
    await seed({ plan: "pro", orgs: 1, orgLimit: 1 });
    const { env: e } = quietEnv();
    await reconcileUser(e, testDb(), "owner-1", NOW);
    expect((await orgLocks()).map((o) => o.lockedAt)).toEqual([null]);
  });

  it("changes nothing when run twice for the same plan", async () => {
    const { env: e } = await downgrade({ plan: "pro", orgs: 3, members: 4, domains: 3 }, "free");
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
    const { env: e } = await downgrade({ plan: "pro", orgs: 3, members: 4, domains: 3 }, "free");

    // Pro alone covers one org now, so getting all three back takes the
    // admin's allowance as well as the plan.
    await setPlan("pro");
    await setOrgs(3);
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
    const { env: e, storage } = await downgrade({ plan: "pro", domains: 3 }, "hobby");
    expect((await entitlement()).graceEndsAt).toBe(NOW + GRACE_PERIOD_MS);

    const later = NOW + 40 * 86_400_000;
    storage.length = 0;
    await setPlan("free");
    await reconcileUser(e, testDb(), "owner-1", later);
    // The domain that only just went over must not inherit an expired clock.
    expect((await entitlement()).graceEndsAt).toBe(later + GRACE_PERIOD_MS);
    // Every locked domain is republished: the KV value carries the deadline,
    // so the two already locked would keep the old one and 404 early.
    expect(storage.map((m) => ("key" in m ? m.key : "")).sort()).toEqual([
      "domain:d0.example.com",
      "domain:d1.example.com",
      "domain:d2.example.com",
    ]);
  });

  it("emails the owner once per grace period, then warns at day 23", async () => {
    await withMail(async (mail) => {
      const { env: e } = await downgrade({ plan: "hobby", domains: 2 }, "free");
      expect(mail.sent.map((m) => m.to)).toEqual(["owner@example.com"]);
      expect(mail.sent[0].subject).toContain("over its plan");
      // About their own account: "Not you? Ignore it" would be bad advice.
      expect(mail.sent[0].text).toContain("Questions? Write to support@mail.rdyrct.com.");
      expect(mail.sent[0].text).not.toContain("Not you?");

      await reconcileUser(e, testDb(), "owner-1", NOW + 1000);
      expect(mail.sent).toHaveLength(1);

      const day23 = NOW + GRACE_PERIOD_MS - 6 * 86_400_000;
      expect(await sweepGraceWarnings(e, testDb(), day23)).toBe(1);
      expect(mail.sent).toHaveLength(2);
      expect(mail.sent[1].subject).toContain("loses its custom domains soon");
      expect(await sweepGraceWarnings(e, testDb(), day23 + 1000)).toBe(0);
    });
  });

  it("leaves a grace with more than a week left alone", async () => {
    await withMail(async () => {
      const { env: e } = await downgrade({ plan: "hobby", domains: 2 }, "free");
      expect(await sweepGraceWarnings(e, testDb(), NOW + 86_400_000)).toBe(0);
    });
  });
});
