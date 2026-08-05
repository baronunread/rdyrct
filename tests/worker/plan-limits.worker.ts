import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import { hashPassword } from "../../src/worker/password";
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
  return signInCookie(email, TEST_PASSWORD);
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
  async function seedOrgWithOneSlotLeft() {
    const db = drizzle(env.DB, { schema });
    // members cap on free is 3 (owner + 2): seed the owner and one more
    // member, leaving exactly one open seat.
    await db.batch([
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
      db.insert(schema.user).values({
        id: "member-1",
        name: "Member",
        email: "member1@example.com",
        emailVerified: true,
        isAdmin: false,
        plan: "free",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
      db.insert(schema.orgMembers).values({
        orgId: "org-race",
        userId: "member-1",
        role: "member",
        createdAt: 0,
      }),
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
    ]);
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
    expect(members?.n).toBe(3);
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

    // free plan's links cap is 30: seed 29 active addresses, leaving one slot.
    const rows = Array.from({ length: 29 }, (_, i) => ({
      link: rawLinkRow({
        id: `seed-link-${i}`,
        orgId: "org-links",
        slug: `seed-${i}`,
        destination: "https://example.com",
        createdAt: 0,
      }),
      address: rawAddressRow({
        id: `seed-addr-${i}`,
        linkId: `seed-link-${i}`,
        orgId: "org-links",
        slug: `seed-${i}`,
        kind: "primary",
        createdAt: 0,
      }),
    }));
    await db.batch([
      ...rows.map((r) => db.insert(schema.links).values(r.link)),
      ...rows.map((r) => db.insert(schema.linkAddresses).values(r.address)),
    ] as never);

    const [a, b] = await Promise.all([
      postLink(cookie, "org-links"),
      postLink(cookie, "org-links"),
    ]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([201, 402]);

    const activeAddresses = await env.DB.prepare(
      "select count(*) as n from link_addresses where org_id = 'org-links' and retired_at is null and kind in ('primary','permanent_alias')",
    ).first<{ n: number }>();
    expect(activeAddresses?.n).toBe(30);

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
