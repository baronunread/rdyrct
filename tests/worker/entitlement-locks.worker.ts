import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { eq } from "drizzle-orm";
import * as schema from "../../src/worker/db/schema";
import { hashPassword } from "../../src/worker/password";
import {
  applyTestMigrations,
  fetchWorker,
  jsonBody,
  signInCookie,
  TEST_PASSWORD,
  testDb,
} from "./support";
import type { CurrentUser, DomainDTO, LinkInput } from "../../src/shared/types";

/**
 * What a lock does once reconciliation has written it: the redirect path's
 * verdict (#159), the org-wide read-only state (#160), who may still be
 * handed write access (#161), and the QR styling that survives a save (#162).
 *
 * The pass itself is covered in reconcile.worker.ts. These are the places
 * that read what it wrote.
 */

const HOUR = 60 * 60 * 1000;

async function seedOwner(plan = "free"): Promise<string> {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('owner-1', 'Owner', 'owner@example.com', 1, 0, ?, 0, 0)",
    ).bind(plan),
    env.DB.prepare(
      "insert into account (id, account_id, issuer, provider_id, user_id, password, created_at, updated_at) values ('acct-1', 'owner-1', 'local:credential', 'credential', 'owner-1', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'First', 1)"),
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-2', 'Second', 2)"),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'owner-1', 'owner', 0)",
    ),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-2', 'owner-1', 'owner', 0)",
    ),
  ]);
  return signInCookie("owner@example.com", TEST_PASSWORD);
}

async function lockOrg(orgId: string) {
  await testDb().update(schema.orgs).set({ lockedAt: 1 }).where(eq(schema.orgs.id, orgId));
}

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});

describe("a locked custom domain (#159)", () => {
  async function publish(servesUntil: number | null) {
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Test', 0)"),
      env.DB.prepare(
        "insert into links (id, org_id, slug, destination, created_at) values ('link-1', 'org-1', 'sale', 'https://example.com/sale', 0)",
      ),
    ]);
    await env.LINKS.put(
      "domain:go.example.com",
      JSON.stringify({
        domainId: "dom-1",
        orgId: "org-1",
        rootRedirect: "https://example.com",
        servesUntil,
      }),
    );
    await env.LINKS.put(
      "slug:go.example.com:sale",
      JSON.stringify({ linkId: "link-1", orgId: "org-1", url: "https://example.com/sale" }),
    );
  }

  const hit = () =>
    fetchWorker(new Request("http://go.example.com/sale", { headers: { host: "go.example.com" } }));

  it("keeps redirecting inside the grace period", async () => {
    await publish(Date.now() + HOUR);
    expect((await hit()).status).toBe(302);
  });

  it("stops resolving once the grace period has ended", async () => {
    await publish(Date.now() - HOUR);
    const res = await hit();
    expect(res.status).toBe(404);
    // The root redirect goes with it: the whole host stops answering, not
    // just the slug.
    const root = await fetchWorker(
      new Request("http://go.example.com/", { headers: { host: "go.example.com" } }),
    );
    expect(root.status).toBe(404);
  });

  it("keeps serving a value written before the field existed", async () => {
    await publish(null);
    await env.LINKS.put(
      "domain:go.example.com",
      JSON.stringify({ domainId: "dom-1", orgId: "org-1", rootRedirect: "https://example.com" }),
    );
    expect((await hit()).status).toBe(302);
  });
});

describe("a locked org (#160)", () => {
  it("refuses every write and still serves every read", async () => {
    const cookie = await seedOwner();
    await lockOrg("org-2");

    const read = await fetchWorker(
      new Request("http://localhost/api/orgs/org-2/links", { headers: { cookie } }),
    );
    expect(read.status).toBe(200);

    const write = await fetchWorker(
      new Request("http://localhost/api/orgs/org-2", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );
    expect(write.status).toBe(403);
    expect(await jsonBody<{ code: string }>(write)).toMatchObject({ code: "org_locked" });
  });

  it("can still be deleted, which is one of the two ways out", async () => {
    const cookie = await seedOwner();
    await lockOrg("org-2");
    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-2", { method: "DELETE", headers: { cookie } }),
    );
    expect(res.status).toBe(200);
  });

  it("reports itself as locked to the app", async () => {
    const cookie = await seedOwner();
    await lockOrg("org-2");
    const res = await fetchWorker(
      new Request("http://localhost/api/user", { headers: { cookie } }),
    );
    const body = await jsonBody<CurrentUser>(res);
    // Sorted: currentUserFor has no ORDER BY, so row order is incidental.
    expect(body.orgs.map((o) => [o.id, o.locked]).sort()).toEqual([
      ["org-1", false],
      ["org-2", true],
    ]);
  });

  it("swaps which org is active when the owner picks the locked one", async () => {
    const cookie = await seedOwner();
    await lockOrg("org-2");
    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-2/keep-active", {
        method: "POST",
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    const rows = await testDb().select().from(schema.orgs).orderBy(schema.orgs.createdAt);
    expect(rows.map((o) => [o.id, o.lockedAt !== null])).toEqual([
      ["org-1", true],
      ["org-2", false],
    ]);
  });
});

describe("who may write in an over-cap org (#161)", () => {
  async function seedDemoted() {
    const cookie = await seedOwner();
    await env.DB.batch([
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('m1', 'One', 'one@example.com', 1, 0, 'free', 0, 0)",
      ),
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('m2', 'Two', 'two@example.com', 1, 0, 'free', 0, 0)",
      ),
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('m3', 'Three', 'three@example.com', 1, 0, 'free', 0, 0)",
      ),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'm1', 'member', 1)",
      ),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'm2', 'member', 2)",
      ),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, previous_role, created_at) values ('org-1', 'm3', 'viewer', 'member', 3)",
      ),
    ]);
    return cookie;
  }

  const promote = (cookie: string, userId: string, role: string) =>
    fetchWorker(
      new Request(`http://localhost/api/orgs/org-1/members/${userId}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    );

  it("refuses to hand out write access the plan has no room for", async () => {
    const cookie = await seedDemoted();
    const res = await promote(cookie, "m3", "member");
    expect(res.status).toBe(402);
    expect(await jsonBody<{ code: string }>(res)).toMatchObject({ code: "member_limit" });
  });

  it("lets the owner swap who writes, by demoting first", async () => {
    const cookie = await seedDemoted();
    expect((await promote(cookie, "m1", "viewer")).status).toBe(200);
    expect((await promote(cookie, "m3", "member")).status).toBe(200);
    const rows = await testDb()
      .select()
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, "org-1"))
      .orderBy(schema.orgMembers.createdAt);
    expect(rows.map((r) => [r.userId, r.role, r.previousRole])).toEqual([
      ["owner-1", "owner", null],
      ["m1", "viewer", null],
      ["m2", "member", null],
      // An explicit choice replaces the recorded one, so a later upgrade has
      // nothing of its own to restore over it.
      ["m3", "member", null],
    ]);
  });
});

describe("QR styling on a downgraded plan (#162)", () => {
  async function seedStyledLink(cookie: string) {
    await env.DB.batch([
      env.DB.prepare(
        "insert into links (id, org_id, slug, destination, title, qr_logo, qr_style, qr_color, qr_corner, qr_bg, qr_eye_color, created_at) values ('link-1', 'org-1', 'sale', 'https://example.com', 'Sale', '', 'dots', '#ff0000', '', '', '', 0)",
      ),
      env.DB.prepare(
        "insert into link_addresses (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at) values ('addr-1', 'link-1', 'org-1', null, 'sale', 'primary', 'created', null, null, 0)",
      ),
    ]);
    return cookie;
  }

  const save = (cookie: string, body: Partial<LinkInput>) =>
    fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links/link-1", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("saves another field while the styling rides along unchanged", async () => {
    const cookie = await seedStyledLink(await seedOwner());
    const res = await save(cookie, {
      title: "Autumn sale",
      qrStyle: "dots",
      qrColor: "#ff0000",
      qrLogo: "",
      qrCorner: "",
      qrBg: "",
      qrEyeColor: "",
      qrLogoSize: null,
    });
    expect(res.status).toBe(200);
    const [row] = await testDb().select().from(schema.links).where(eq(schema.links.id, "link-1"));
    // The wipe this replaced: a title edit used to blank all of these.
    expect([row.title, row.qrStyle, row.qrColor]).toEqual(["Autumn sale", "dots", "#ff0000"]);
  });

  it("still refuses an actual change to the styling", async () => {
    const cookie = await seedStyledLink(await seedOwner());
    const res = await save(cookie, { qrColor: "#00ff00" });
    expect(res.status).toBe(402);
    expect(await jsonBody<{ code: string }>(res)).toMatchObject({ code: "qr_locked" });
  });

  it("lets a downgraded org clear its styling without upgrading", async () => {
    const cookie = await seedStyledLink(await seedOwner());
    expect((await save(cookie, { qrStyle: "", qrColor: "" })).status).toBe(200);
  });

  it("clears the logo size when asked, rather than keeping the old one", async () => {
    const cookie = await seedStyledLink(await seedOwner("pro"));
    await env.DB.prepare("update links set qr_logo_size = 0.4 where id = 'link-1'").run();
    expect((await save(cookie, { qrLogoSize: null })).status).toBe(200);
    const [row] = await testDb().select().from(schema.links).where(eq(schema.links.id, "link-1"));
    expect(row.qrLogoSize).toBeNull();
  });

  it("treats the org's own QR defaults the same way", async () => {
    const cookie = await seedOwner();
    await env.DB.prepare("update orgs set qr_style = 'dots' where id = 'org-1'").run();
    const patch = (body: Record<string, string>) =>
      fetchWorker(
        new Request("http://localhost/api/orgs/org-1", {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    // Renaming the org while its stored defaults ride along unchanged.
    expect((await patch({ name: "Renamed", qrStyle: "dots" })).status).toBe(200);
    // An actual change is still refused, on the same plan.
    expect((await patch({ qrStyle: "square" })).status).toBe(402);
    const [row] = await testDb().select().from(schema.orgs).where(eq(schema.orgs.id, "org-1"));
    expect([row.name, row.qrStyle]).toEqual(["Renamed", "dots"]);
  });
});

describe("a locked domain takes no new links (#159)", () => {
  it("refuses to be the org's default or to host a new link", async () => {
    const cookie = await seedOwner("pro");
    await env.DB.prepare(
      "insert into domains (id, org_id, hostname, status, locked_at, created_at) values ('dom-1', 'org-1', 'go.example.com', 'active', 1, 0)",
    ).run();

    const asDefault = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ defaultDomainId: "dom-1" }),
      }),
    );
    expect(asDefault.status).toBe(402);

    const newLink = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://example.com", domainId: "dom-1" }),
      }),
    );
    expect(newLink.status).toBe(402);
  });

  it("reports the lock to the app", async () => {
    const cookie = await seedOwner("pro");
    await env.DB.prepare(
      "insert into domains (id, org_id, hostname, status, locked_at, created_at) values ('dom-1', 'org-1', 'go.example.com', 'active', 1, 0)",
    ).run();
    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/domains", { headers: { cookie } }),
    );
    expect((await jsonBody<DomainDTO[]>(res))[0].lockedAt).toBe(1);
  });
});
