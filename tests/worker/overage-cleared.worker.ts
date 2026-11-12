import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { eq } from "drizzle-orm";
import * as schema from "../../src/worker/db/schema";
import { hashPassword } from "../../src/worker/password";
import { reconcileUser, sweepGraceWarnings } from "../../src/worker/reconcile";
import { GRACE_PERIOD_MS, GRACE_WARNING_MS, type CurrentUser } from "../../src/shared/types";
import {
  applyTestMigrations,
  authEnv,
  captureEmails,
  fetchWorker,
  jsonBody,
  overrideEnv,
  seedFillerLinks,
  signInCookie,
  TEST_PASSWORD,
  testDb,
} from "./support";

/**
 * Fixing an overage by hand (#486): an owner who deletes what a downgrade put
 * over the cap gets the locks, the banner and the day-23 email lifted, with
 * no plan change. The pass itself is covered in reconcile.worker.ts; these
 * are the deletes that now run it.
 */

let mail: ReturnType<typeof captureEmails>;

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
  mail = captureEmails();
});
afterEach(() => mail.restore());

/** Fake Cloudflare for the domain delete's custom-hostname teardown. */
const routeEnv = () => overrideEnv({ ...authEnv(), CF_DEV_ENV: "instant" });

/** A pro owner of org-1 with `members` extra members and `domains` active
 * domains (d0 oldest), signed in. */
async function seed({ members = 0, domains = 0 }: { members?: number; domains?: number }) {
  const statements = [
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('owner-1', 'Owner', 'owner@example.com', 1, 0, 'pro', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-1', 'owner-1', 'credential', 'owner-1', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Acme', 0)"),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'owner-1', 'owner', 0)",
    ),
  ];
  for (let i = 0; i < members; i++)
    statements.push(
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, ?, ?, 1, 0, 'free', 0, 0)",
      ).bind(`member-${i}`, `Member ${i}`, `member${i}@example.com`),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('org-1', ?, 'member', ?)",
      ).bind(`member-${i}`, i + 1),
    );
  for (let i = 0; i < domains; i++)
    statements.push(
      env.DB.prepare(
        "insert into domains (id, org_id, hostname, status, created_at) values (?, 'org-1', ?, 'active', ?)",
      ).bind(`dom-${i}`, `d${i}.example.com`, i),
    );
  await env.DB.batch(statements);
  return signInCookie("owner@example.com", TEST_PASSWORD);
}

/** Drops the owner to `plan` and runs the pass a webhook would. */
async function downgrade(plan: string) {
  await env.DB.prepare("update user set plan = ? where id = 'owner-1'").bind(plan).run();
  await reconcileUser(routeEnv(), testDb(), "owner-1");
}

const send = (cookie: string, method: string, path: string, body?: { role: string }) =>
  fetchWorker(
    new Request(`http://localhost/api/orgs/org-1${path}`, {
      method,
      headers: body ? { cookie, "content-type": "application/json" } : { cookie },
      body: body ? JSON.stringify(body) : undefined,
    }),
    routeEnv(),
  );

async function roles() {
  const rows = await testDb().select().from(schema.orgMembers);
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]));
}

async function entitlement() {
  const [row] = await testDb()
    .select()
    .from(schema.orgEntitlements)
    .where(eq(schema.orgEntitlements.orgId, "org-1"));
  return row;
}

/** What the app's banner reads. */
async function bannerState(cookie: string) {
  const res = await fetchWorker(
    new Request("http://localhost/api/user", { headers: { cookie } }),
    routeEnv(),
  );
  const org = (await jsonBody<CurrentUser>(res)).orgs.find((o) => o.id === "org-1")!;
  return { over: org.over, graceEndsAt: org.graceEndsAt };
}

/** Runs the daily sweep a week before the grace ends, and returns who it mailed. */
async function day23Mail() {
  mail.sent.length = 0;
  await sweepGraceWarnings(routeEnv(), testDb(), Date.now() + GRACE_PERIOD_MS - GRACE_WARNING_MS);
  return mail.sent.map((m) => m.to);
}

async function domainLocks() {
  const rows = await testDb().select().from(schema.domains).orderBy(schema.domains.createdAt);
  return Object.fromEntries(rows.map((r) => [r.id, r.lockedAt]));
}

async function servesUntil(hostname: string) {
  const value = await env.LINKS.get(`domain:${hostname}`);
  return value === null ? undefined : (JSON.parse(value).servesUntil ?? null);
}

describe("deleting the domain a downgrade put over the cap", () => {
  it("unlocks the one left, in D1 and KV, and clears the banner and the day-23 email", async () => {
    const cookie = await seed({ domains: 2 });
    await downgrade("hobby");
    // Hobby keeps one domain: d1 is locked and KV carries its deadline.
    expect((await domainLocks())["dom-1"]).not.toBeNull();
    expect(await servesUntil("d1.example.com")).toBe((await entitlement()).graceEndsAt);
    expect((await bannerState(cookie)).over).toEqual({ domains: 2 });

    // The owner removes the older, unlocked one: d1 is the one that fits now.
    expect((await send(cookie, "DELETE", "/domains/dom-0")).status).toBe(200);

    expect(await domainLocks()).toEqual({ "dom-1": null });
    expect(await servesUntil("d1.example.com")).toBeNull();
    expect(await servesUntil("d0.example.com")).toBeUndefined();
    expect(await bannerState(cookie)).toEqual({ over: {}, graceEndsAt: null });
    expect(await day23Mail()).toEqual([]);
  });

  it("keeps the same deadline while the org is still over", async () => {
    const cookie = await seed({ domains: 3 });
    await downgrade("hobby");
    const before = await entitlement();
    // Without a fix, the day-23 sweep would send for this org.
    expect(before.graceEndsAt).not.toBeNull();

    expect((await send(cookie, "DELETE", "/domains/dom-2")).status).toBe(200);

    const after = await entitlement();
    expect(JSON.parse(after.overJson)).toEqual({ domains: 2 });
    // A delete is not a plan change: the grace period does not restart.
    expect(after.graceEndsAt).toBe(before.graceEndsAt);
    expect((await domainLocks())["dom-1"]).not.toBeNull();
    expect(await day23Mail()).toEqual(["owner@example.com"]);
  });
});

describe("removing a member a downgrade put over the cap", () => {
  it("gives the demoted member their role back and clears the banner", async () => {
    // Free allows three: the owner and the two longest-standing members.
    const cookie = await seed({ members: 3 });
    await downgrade("free");
    const role = async (userId: string) =>
      (
        await testDb()
          .select({ role: schema.orgMembers.role })
          .from(schema.orgMembers)
          .where(eq(schema.orgMembers.userId, userId))
      )[0]?.role;
    expect(await role("member-2")).toBe("viewer");

    expect((await send(cookie, "DELETE", "/members/member-0")).status).toBe(200);

    expect(await role("member-2")).toBe("member");
    expect(await bannerState(cookie)).toEqual({ over: {}, graceEndsAt: null });
    expect(await day23Mail()).toEqual([]);
  });
});

describe("a delete after the owner chose who writes", () => {
  it("never takes that choice back", async () => {
    // Free allows three writers. Seniority keeps the owner, member-0 and
    // member-1; member-2 to member-4 are demoted.
    const cookie = await seed({ members: 5 });
    await downgrade("free");
    expect(await roles()).toMatchObject({ "member-0": "member", "member-2": "viewer" });

    // The owner swaps: member-0 steps down, member-4 writes.
    expect((await send(cookie, "PATCH", "/members/member-0", { role: "viewer" })).status).toBe(200);
    expect((await send(cookie, "PATCH", "/members/member-4", { role: "member" })).status).toBe(200);
    const chosen = {
      "owner-1": "owner",
      "member-0": "viewer",
      "member-1": "member",
      "member-2": "viewer",
      "member-3": "viewer",
      "member-4": "member",
    };
    expect(await roles()).toEqual(chosen);

    // Removing a viewer leaves five members on a three-writer plan.
    expect((await send(cookie, "DELETE", "/members/member-3")).status).toBe(200);

    expect(await roles()).toEqual({ ...chosen, "member-3": undefined });
    expect((await bannerState(cookie)).over).toEqual({ members: 5 });
  });

  it("still restores a demoted member into a free writer seat", async () => {
    const cookie = await seed({ members: 5 });
    await downgrade("free");
    // Remove a writer: one seat opens, and the longest-standing viewer takes it.
    expect((await send(cookie, "DELETE", "/members/member-1")).status).toBe(200);
    expect(await roles()).toMatchObject({ "member-0": "member", "member-2": "member" });
    expect((await roles())["member-3"]).toBe("viewer");
  });
});

describe("a delete that races a plan change", () => {
  it("leaves the grace period and the day-0 email to the plan change's own pass", async () => {
    const cookie = await seed({ domains: 3 });
    await downgrade("hobby");
    const before = await entitlement();
    mail.sent.length = 0;

    // The webhook has written the new plan but its pass has not run yet.
    await env.DB.prepare("update user set plan = 'free' where id = 'owner-1'").run();
    expect((await send(cookie, "DELETE", "/domains/dom-2")).status).toBe(200);

    const after = await entitlement();
    expect(after.plan).toBe("hobby");
    expect(after.graceEndsAt).toBe(before.graceEndsAt);
    expect(after.reconciledAt).toBe(before.reconciledAt);
    expect(mail.sent).toEqual([]);
  });
});

describe("deleting links a downgrade put over the cap", () => {
  it("clears the overage when the last permanent alias over the cap is removed", async () => {
    const cookie = await seed({});
    // Free allows 30 addresses: the primaries fill it, one permanent alias is the 31st.
    await seedFillerLinks(testDb(), "org-1", 30, "f");
    await env.DB.prepare(
      "insert into link_addresses (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at) values ('alias-1', 'f-link-0', 'org-1', null, 'f-extra', 'permanent_alias', 'created', null, null, 0)",
    ).run();
    await downgrade("free");
    expect((await bannerState(cookie)).over).toEqual({ links: 31 });

    expect((await send(cookie, "DELETE", "/links/f-link-0/addresses/alias-1")).status).toBe(200);

    expect(await bannerState(cookie)).toEqual({ over: {}, graceEndsAt: null });
    expect(await day23Mail()).toEqual([]);
  });

  it("clears the overage once the org is back under, and not before", async () => {
    const cookie = await seed({});
    // Free allows 30: two over.
    await seedFillerLinks(testDb(), "org-1", 32, "f");
    await downgrade("free");
    expect((await bannerState(cookie)).over).toEqual({ links: 32 });

    expect((await send(cookie, "DELETE", "/links/f-link-0")).status).toBe(200);
    expect((await bannerState(cookie)).over).toEqual({ links: 31 });

    expect((await send(cookie, "DELETE", "/links/f-link-1")).status).toBe(200);
    expect(await bannerState(cookie)).toEqual({ over: {}, graceEndsAt: null });
    expect(await day23Mail()).toEqual([]);
  });
});

describe("a delete that cannot end an overage", () => {
  it("does not run the pass for an org that was never over", async () => {
    const cookie = await seed({});
    await seedFillerLinks(testDb(), "org-1", 1, "f");
    expect((await send(cookie, "DELETE", "/links/f-link-0")).status).toBe(200);
    // Every pass writes a row, so none means none ran.
    expect(await entitlement()).toBeUndefined();
  });

  it("does not run the pass when the org is over on something else", async () => {
    const cookie = await seed({ members: 1, domains: 1 });
    await seedFillerLinks(testDb(), "org-1", 1, "f");
    await downgrade("free");
    const before = await entitlement();
    expect(JSON.parse(before.overJson)).toEqual({ domains: 1 });

    expect((await send(cookie, "DELETE", "/links/f-link-0")).status).toBe(200);
    expect((await send(cookie, "DELETE", "/members/member-0")).status).toBe(200);

    expect((await entitlement()).reconciledAt).toBe(before.reconciledAt);
  });
});
