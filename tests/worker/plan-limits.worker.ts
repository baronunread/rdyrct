import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import { hashPassword } from "../../src/worker/password";
import { PLAN_LIMITS } from "@/shared/types";
import {
  applyTestMigrations,
  authEnv,
  rawAddressRow,
  rawLinkRow,
  signInCookie,
  TEST_PASSWORD,
} from "./support";

async function fetchWorker(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, authEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedFreeUser(id: string, email: string): Promise<string> {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, 'Test', ?, 1, 0, 'free', 0, 0)",
    ).bind(id, email),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values (?, ?, 'credential', ?, ?, 0, 0)",
    ).bind(`acct-${id}`, id, id, await hashPassword(TEST_PASSWORD)),
  ]);
  const cookie = await signInCookie(email, TEST_PASSWORD);
  // Signing in hands every account an organization, which on the free plan is
  // the entire allowance. These tests are about the cap with room left, so
  // start them where they started before it existed: at zero owned.
  await env.DB.batch([
    env.DB.prepare("delete from org_members where user_id = ?").bind(id),
    env.DB.prepare(
      "delete from orgs where not exists (select 1 from org_members where org_id = orgs.id)",
    ),
  ]);
  return cookie;
}

async function postOrg(cookie: string): Promise<Response> {
  return fetchWorker(
    new Request("http://localhost/api/orgs", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Race org" }),
    }),
  );
}

async function acceptInvite(cookie: string, token: string): Promise<Response> {
  return fetchWorker(
    new Request(`http://localhost/api/invites/${token}/accept`, {
      method: "POST",
      headers: { cookie },
    }),
  );
}

async function postLink(cookie: string, orgId: string): Promise<Response> {
  return fetchWorker(
    new Request(`http://localhost/api/orgs/${orgId}/links`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ destination: `https://example.com/${Math.random()}` }),
    }),
  );
}

async function postDomain(cookie: string, orgId: string, hostname: string): Promise<Response> {
  return fetchWorker(
    new Request(`http://localhost/api/orgs/${orgId}/domains`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ hostname }),
    }),
  );
}

async function postKeepForever(
  cookie: string,
  orgId: string,
  linkId: string,
  addressId: string,
): Promise<Response> {
  return fetchWorker(
    new Request(
      `http://localhost/api/orgs/${orgId}/links/${linkId}/addresses/${addressId}/keep-forever`,
      { method: "POST", headers: { cookie } },
    ),
  );
}

async function seedPaidUser(id: string, email: string, plan: "hobby" | "pro"): Promise<string> {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, 'Test', ?, 1, 0, ?, 0, 0)",
    ).bind(id, email, plan),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values (?, ?, 'credential', ?, ?, 0, 0)",
    ).bind(`acct-${id}`, id, id, await hashPassword(TEST_PASSWORD)),
  ]);
  return signInCookie(email, TEST_PASSWORD);
}

// Seeds `count` active links (each with its own primary address), so a
// caller can fill an org up to just under its links cap before racing the
// last slot.
async function seedFillerLinks(
  db: ReturnType<typeof drizzle>,
  orgId: string,
  count: number,
  idPrefix: string,
) {
  const rows = Array.from({ length: count }, (_, i) => ({
    link: rawLinkRow({
      id: `${idPrefix}-link-${i}`,
      orgId,
      slug: `${idPrefix}-${i}`,
      destination: "https://example.com",
      createdAt: 0,
    }),
    address: rawAddressRow({
      id: `${idPrefix}-addr-${i}`,
      linkId: `${idPrefix}-link-${i}`,
      orgId,
      slug: `${idPrefix}-${i}`,
      kind: "primary",
      createdAt: 0,
    }),
  }));
  const writes = [
    ...rows.map((r) => db.insert(schema.links).values(r.link)),
    ...rows.map((r) => db.insert(schema.linkAddresses).values(r.address)),
  ];
  await db.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
}

beforeEach(applyTestMigrations);
afterEach(reset);

describe("org creation: owned-org cap under concurrency (#18)", () => {
  it("lets exactly one of two concurrent creates through for a free user (cap 1)", async () => {
    const cookie = await seedFreeUser("racer-1", "racer1@example.com");

    const [a, b] = await Promise.all([postOrg(cookie), postOrg(cookie)]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([201, 402]);

    const owned = await env.DB.prepare(
      "select count(*) as n from org_members where user_id = ? and role = 'owner'",
    )
      .bind("racer-1")
      .first<{ n: number }>();
    expect(owned?.n).toBe(1);

    // No org can ever persist without an owner: assert the invariant directly,
    // not just that this one call was gated.
    const orphaned = await env.DB.prepare(
      "select count(*) as n from orgs where id not in (select org_id from org_members)",
    ).first<{ n: number }>();
    expect(orphaned?.n).toBe(0);
  });
});

describe("invite acceptance: member cap and duplicate accept under concurrency (#18)", () => {
  // Seeds the owner plus enough additional members to leave exactly one open
  // seat under the free plan's real member cap (PLAN_LIMITS.free.members),
  // so this test tracks the actual limit instead of a number that can drift
  // out of sync with it.
  async function seedOrgWithOneSlotLeft() {
    const db = drizzle(env.DB, { schema });
    const extraMembers = PLAN_LIMITS.free.members - 2; // -1 for the owner, -1 for the open seat
    const statements = [
      db.insert(schema.orgs).values({ id: "org-race", name: "Race org", createdAt: 0 }),
      db.insert(schema.user).values({
        id: "owner-1",
        name: "Owner",
        email: "owner1@example.com",
        emailVerified: true,
        isAdmin: false,
        plan: "free",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
      db.insert(schema.orgMembers).values({
        orgId: "org-race",
        userId: "owner-1",
        role: "owner",
        createdAt: 0,
      }),
      ...Array.from({ length: extraMembers }, (_, i) => [
        db.insert(schema.user).values({
          id: `member-${i}`,
          name: "Member",
          email: `member${i}@example.com`,
          emailVerified: true,
          isAdmin: false,
          plan: "free",
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
        db.insert(schema.orgMembers).values({
          orgId: "org-race",
          userId: `member-${i}`,
          role: "member",
          createdAt: 0,
        }),
      ]).flat(),
      db.insert(schema.invites).values({
        token: "bearer-invite",
        orgId: "org-race",
        role: "member",
        email: null,
        createdBy: "owner-1",
        createdAt: 0,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        acceptedBy: null,
      }),
    ];
    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  }

  it("lets exactly one of two racing users through the last seat", async () => {
    await seedOrgWithOneSlotLeft();
    const cookieA = await seedFreeUser("racer-a", "racera@example.com");
    const cookieB = await seedFreeUser("racer-b", "racerb@example.com");

    const [a, b] = await Promise.all([
      acceptInvite(cookieA, "bearer-invite"),
      acceptInvite(cookieB, "bearer-invite"),
    ]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([200, 402]);

    const members = await env.DB.prepare(
      "select count(*) as n from org_members where org_id = 'org-race'",
    ).first<{ n: number }>();
    expect(members?.n).toBe(PLAN_LIMITS.free.members);
  });

  it("gives the same user's two concurrent accepts one valid outcome", async () => {
    await seedOrgWithOneSlotLeft();
    const cookie = await seedFreeUser("racer-c", "racerc@example.com");

    const [a, b] = await Promise.all([
      acceptInvite(cookie, "bearer-invite"),
      acceptInvite(cookie, "bearer-invite"),
    ]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([200, 409]);

    const membership = await env.DB.prepare(
      "select count(*) as n from org_members where org_id = 'org-race' and user_id = 'racer-c'",
    ).first<{ n: number }>();
    expect(membership?.n).toBe(1);
  });
});

describe("link creation: links cap under concurrency (#18)", () => {
  it("lets exactly one of two concurrent creates through for the last slot", async () => {
    const cookie = await seedFreeUser("link-owner", "linkowner@example.com");
    const db = drizzle(env.DB, { schema });
    await db.insert(schema.orgs).values({ id: "org-links", name: "Race org", createdAt: 0 });
    await db.insert(schema.orgMembers).values({
      orgId: "org-links",
      userId: "link-owner",
      role: "owner",
      createdAt: 0,
    });

    // Seed enough active addresses to leave exactly one slot under the free
    // plan's real links cap (PLAN_LIMITS.free.links).
    await seedFillerLinks(db, "org-links", PLAN_LIMITS.free.links - 1, "seed");

    const [a, b] = await Promise.all([
      postLink(cookie, "org-links"),
      postLink(cookie, "org-links"),
    ]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([201, 402]);

    const activeAddresses = await env.DB.prepare(
      "select count(*) as n from link_addresses where org_id = 'org-links' and retired_at is null and kind in ('primary','permanent_alias')",
    ).first<{ n: number }>();
    expect(activeAddresses?.n).toBe(PLAN_LIMITS.free.links);

    // Every links row must have kept its primary address: no link can persist
    // without one (the compensating rollback on a lost race).
    const orphanedLinks = await env.DB.prepare(
      `select count(*) as n from links
       where org_id = 'org-links'
         and id not in (select link_id from link_addresses where kind = 'primary')`,
    ).first<{ n: number }>();
    expect(orphanedLinks?.n).toBe(0);
  });
});

describe("domain creation: domains cap under concurrency (#18)", () => {
  it("lets exactly one of two concurrent creates through for the last slot", async () => {
    const cookie = await seedPaidUser("domain-owner", "domainowner@example.com", "hobby");
    const db = drizzle(env.DB, { schema });
    await db.insert(schema.orgs).values({ id: "org-domains", name: "Race org", createdAt: 0 });
    await db.insert(schema.orgMembers).values({
      orgId: "org-domains",
      userId: "domain-owner",
      role: "owner",
      createdAt: 0,
    });
    // hobby plan's domains cap is 1: no existing domains, so both requests
    // race for the single available slot.
    expect(PLAN_LIMITS.hobby.domains).toBe(1);

    const [a, b] = await Promise.all([
      postDomain(cookie, "org-domains", "race-a.example.com"),
      postDomain(cookie, "org-domains", "race-b.example.com"),
    ]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([201, 402]);

    const domains = await env.DB.prepare(
      "select count(*) as n from domains where org_id = 'org-domains'",
    ).first<{ n: number }>();
    expect(domains?.n).toBe(PLAN_LIMITS.hobby.domains);
  });
});

describe("keep-forever: links cap under concurrency, and no false upgrade prompt (#18)", () => {
  async function seedOrgWithLinkAndTempAlias(orgId: string, ownerId: string) {
    const db = drizzle(env.DB, { schema });
    await db.batch([
      db.insert(schema.orgs).values({ id: orgId, name: "Race org", createdAt: 0 }),
      db.insert(schema.orgMembers).values({ orgId, userId: ownerId, role: "owner", createdAt: 0 }),
      db.insert(schema.links).values(
        rawLinkRow({
          id: "link-1",
          orgId,
          slug: "sale",
          destination: "https://example.com",
          createdAt: 0,
        }),
      ),
      db.insert(schema.linkAddresses).values(
        rawAddressRow({
          id: "addr-primary",
          linkId: "link-1",
          orgId,
          slug: "sale",
          kind: "primary",
          createdAt: 0,
        }),
      ),
      db.insert(schema.linkAddresses).values(
        rawAddressRow({
          id: "addr-temp",
          linkId: "link-1",
          orgId,
          slug: "sale-old",
          kind: "temp_alias",
          createdAt: 0,
          expiresAt: Date.now() + 48 * 60 * 60 * 1000,
        }),
      ),
    ]);
  }

  it("still 402s when the cap is genuinely exceeded, not a same-address race", async () => {
    const cookie = await seedFreeUser("keep-owner-1", "keepowner1@example.com");
    await seedOrgWithLinkAndTempAlias("org-keep-1", "keep-owner-1");
    const db = drizzle(env.DB, { schema });
    // Fill every remaining slot except the temp_alias's own primary, which
    // is already counted: the org is now exactly at the free plan's links
    // cap, so promoting the temp_alias would push it over.
    await seedFillerLinks(db, "org-keep-1", PLAN_LIMITS.free.links - 1, "filler");

    const res = await postKeepForever(cookie, "org-keep-1", "link-1", "addr-temp");
    expect(res.status).toBe(402);

    const address = await env.DB.prepare(
      "select kind from link_addresses where id = 'addr-temp'",
    ).first<{ kind: string }>();
    expect(address?.kind).toBe("temp_alias");
  });

  it("a concurrent double-submit doesn't false-positive a 402 for the loser", async () => {
    const cookie = await seedFreeUser("keep-owner-2", "keepowner2@example.com");
    await seedOrgWithLinkAndTempAlias("org-keep-2", "keep-owner-2");

    // Two concurrent keep-forever requests for the *same* address: D1
    // serializes them, so one wins the guarded UPDATE and the other's
    // re-query must see the already-promoted kind and treat it as success,
    // not report a false "upgrade your plan" 402 (see issue #18 review).
    const [a, b] = await Promise.all([
      postKeepForever(cookie, "org-keep-2", "link-1", "addr-temp"),
      postKeepForever(cookie, "org-keep-2", "link-1", "addr-temp"),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const address = await env.DB.prepare(
      "select kind from link_addresses where id = 'addr-temp'",
    ).first<{ kind: string }>();
    expect(address?.kind).toBe("permanent_alias");
  });
});
