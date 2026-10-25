// fallow-ignore-file code-duplication -- worker specs repeat their setup so each reads on its own
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import {
  applyStorageMessage,
  drainStorageOutbox,
  republishOrgs,
  syncDomainMsg,
  syncLinkMsg,
} from "../../src/worker/storage";
import { BAN_PURGE_AFTER_DAYS, purgeBannedOrgs } from "../../src/worker/abuse-hold";
import {
  adminCookie,
  applyTestMigrations,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overriding,
  rawLinkRow,
  testEnv,
} from "./support";

/**
 * A ban: the user is out, every org they own answers "disabled" on every
 * link and custom domain, and 90 days on the daily cron deletes those orgs.
 * An unban before then brings back exactly what was there.
 */

const db = () => drizzle(env.DB, { schema });
const DAY_MS = 24 * 60 * 60 * 1000;

const api = (path: string, cookie: string, init: RequestInit = {}) =>
  fetchWorker(
    new Request(`http://localhost/api${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    }),
  );

const createLink = async (cookie: string, destination: string) =>
  jsonBody<{ id: string; slug: string }>(
    await api("/orgs/org-1/links", cookie, {
      method: "POST",
      body: JSON.stringify({ destination }),
    }),
  );

/** What the ban dialog sends, less the flag itself. */
const ban = (cookie: string, body: { reason?: string; blockHosts?: string[] }) =>
  api("/admin/users/free-1", cookie, {
    method: "PATCH",
    body: JSON.stringify({ banned: true, ...body }),
  });

const unban = (cookie: string) =>
  api("/admin/users/free-1", cookie, { method: "PATCH", body: JSON.stringify({ banned: false }) });

const row = (sql: string, ...binds: (string | number)[]) =>
  env.DB.prepare(sql)
    .bind(...binds)
    .first<Record<string, number | string | null>>();

/** A GET as a browser sends it, Host header included. */
const visit = (host: string, path: string) =>
  fetchWorker(
    new Request(`http://${host}/${path}`, { redirect: "manual", headers: { host } }),
    testEnv,
  );

async function syncKv(slug: string, hostname: string | null = null) {
  await applyStorageMessage(testEnv, db(), syncLinkMsg(slug, hostname));
}

const realFetch = globalThis.fetch;

beforeEach(async () => {
  reset();
  await applyTestMigrations();
  // The destination check runs after each create: an answer it reads as "no
  // verdict", so nothing lands after the test has ended.
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://security.cloudflare-dns.com"))
      return new Response("", { status: 503 });
    return realFetch(input, init);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("banning a user", () => {
  it("disables their org: every link answers 'disabled', and an unban brings back what was there", async () => {
    const owner = await freeOwnerCookie();
    const live = await createLink(owner, "https://example.com/live");
    const held = await createLink(owner, "https://example.com/held");
    const cookie = await adminCookie();
    await api(`/admin/links/${held.id}`, cookie, {
      method: "PATCH",
      body: JSON.stringify({ suspended: true, reason: "separate report" }),
    });

    const res = await ban(cookie, { reason: "phishing" });
    expect(await jsonBody(res)).toEqual({
      orgsDisabled: 1,
      hostsBlocked: 0,
      subscriptionEnded: true,
    });
    expect((await row("select banned from user where id = 'free-1'"))?.banned).toBe(1);
    expect((await row("select count(*) as n from session where user_id = 'free-1'"))?.n).toBe(0);
    expect((await row("select disabled_at as at from orgs where id = 'org-1'"))?.at).not.toBeNull();
    const audit = await row("select detail from admin_actions where action = 'user.ban'");
    expect(audit?.detail).toContain("phishing");

    for (const link of [live, held]) {
      await syncKv(link.slug);
      const page = await visit("localhost", link.slug);
      expect(page.status, link.slug).toBe(410);
      const html = await page.text();
      expect(html).toContain("This link has been disabled.");
      expect(html).not.toContain("example.com");
    }
    // The link rows stay: the ban decides nothing about them on its own.
    expect((await row("select count(*) as n from links"))?.n).toBe(2);

    await unban(cookie);
    expect((await row("select disabled_at as at from orgs where id = 'org-1'"))?.at).toBeNull();
    await syncKv(live.slug);
    await syncKv(held.slug);
    expect((await visit("localhost", live.slug)).status).toBe(302);
    expect((await visit("localhost", held.slug)).status, "held before, held after").toBe(403);
  });

  it("disables the owner's custom domain, root redirect included", async () => {
    await freeOwnerCookie({ id: "dom-1", hostname: "go.example.com" });
    const cookie = await adminCookie();
    await ban(cookie, { reason: "phishing" });
    await applyStorageMessage(testEnv, db(), syncDomainMsg("go.example.com"));

    expect(await env.LINKS.get("domain:go.example.com", "json")).toMatchObject({ disabled: true });
    for (const path of ["", "anything"]) {
      const page = await visit("go.example.com", path);
      expect(page.status, `/${path}`).toBe(410);
      expect(await page.text()).toContain("This link has been disabled.");
    }
  });

  it("needs a reason, and writes nothing without one", async () => {
    await freeOwnerCookie();
    const cookie = await adminCookie();
    expect((await ban(cookie, {})).status).toBe(400);
    expect((await row("select banned from user where id = 'free-1'"))?.banned).toBe(0);
    expect((await row("select disabled_at as at from orgs"))?.at).toBeNull();
  });

  it("still bans when the subscription cannot be ended, and says so", async () => {
    await freeOwnerCookie();
    // A subscription on record, and no Polar to end it with.
    await env.DB.prepare(
      "update user set polar_subscription_id = 'sub_1' where id = 'free-1'",
    ).run();
    const cookie = await adminCookie();

    const res = await ban(cookie, { reason: "phishing" });
    expect(await jsonBody(res)).toMatchObject({ orgsDisabled: 1, subscriptionEnded: false });
    expect((await row("select banned from user where id = 'free-1'"))?.banned).toBe(1);
  });
});

describe("restoring a banned owner's links", () => {
  it("refuses to restore a disabled org's links: only an unban does that", async () => {
    const owner = await freeOwnerCookie();
    await createLink(owner, "https://example.com/a");
    const cookie = await adminCookie();
    await api("/admin/links/orgs/org-1/suspend", cookie, {
      method: "POST",
      body: JSON.stringify({ reason: "report" }),
    });
    await ban(cookie, { reason: "phishing" });

    const restore = await api("/admin/links/orgs/org-1/suspend?suspend=0", cookie, {
      method: "POST",
      body: "{}",
    });
    expect(restore.status).toBe(409);
    expect((await row("select count(*) as n from links where suspended_at is null"))?.n).toBe(0);
  });

  it("refuses to restore one link, or a batch, of a disabled org", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLink(owner, "https://example.com/a");
    const cookie = await adminCookie();
    await api(`/admin/links/${link.id}`, cookie, {
      method: "PATCH",
      body: JSON.stringify({ suspended: true, reason: "report" }),
    });
    await ban(cookie, { reason: "phishing" });

    const one = await api(`/admin/links/${link.id}`, cookie, {
      method: "PATCH",
      body: JSON.stringify({ suspended: false }),
    });
    expect(one.status).toBe(409);

    // Another org's suspended link in the same batch: the refusal restores
    // neither, rather than whichever finished first.
    await db().insert(schema.orgs).values({ id: "org-2", name: "Other", createdAt: 0 });
    await db()
      .insert(schema.links)
      .values(
        rawLinkRow({
          id: "other",
          orgId: "org-2",
          slug: "other12",
          destination: "https://example.com/b",
          createdAt: 0,
          suspendedAt: 1,
          suspendReason: "report",
        }),
      );
    const batch = await api("/admin/links/restore", cookie, {
      method: "POST",
      body: JSON.stringify({ ids: ["other", link.id] }),
    });
    expect(batch.status).toBe(409);
    expect((await row("select count(*) as n from links where suspended_at is null"))?.n).toBe(0);
  });
});

describe("publishing a ban to KV", () => {
  it("leaves no outbox row once the org is published", async () => {
    await freeOwnerCookie();
    await ban(await adminCookie(), { reason: "phishing" });
    expect((await row("select count(*) as n from storage_outbox"))?.n).toBe(0);
  });

  it("keeps an org_sync row when reading the org's keys fails, and the drain finishes it", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLink(owner, "https://example.com/a");
    await syncKv(link.slug);
    await env.DB.prepare("update orgs set disabled_at = 1 where id = 'org-1'").run();

    const broken = overriding(db(), {
      select: () => {
        throw new Error("D1 read failed");
      },
    });
    await republishOrgs(testEnv, broken, ["org-1"]);
    expect(await row("select op, target from storage_outbox")).toEqual({
      op: "org_sync",
      target: "org-1",
    });
    expect((await visit("localhost", link.slug)).status, "KV not yet caught up").toBe(302);

    expect(await drainStorageOutbox(testEnv)).toBe(1);
    expect((await visit("localhost", link.slug)).status).toBe(410);
  });

  it("migration 0046 republishes the orgs of owners banned before it", async () => {
    const owner = await freeOwnerCookie({ id: "dom-1", hostname: "go.example.com" });
    const link = await createLink(owner, "https://example.com/a");
    // The old ban: owner banned, each link suspended "Owner banned", KV
    // holding both as they were.
    await env.DB.batch([
      env.DB.prepare("update user set banned = 1 where id = 'free-1'"),
      env.DB.prepare(
        "update links set suspended_at = 1, suspend_reason = 'Owner banned' where org_id = 'org-1'",
      ),
    ]);
    await syncKv(link.slug);
    await applyStorageMessage(testEnv, db(), syncDomainMsg("go.example.com"));
    expect((await visit("localhost", link.slug)).status).toBe(403);

    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0046"));
    expect(migration, "migration 0046 is missing from the test bundle").toBeTruthy();
    await env.DB.batch(
      migration!.queries
        .filter((query) => !query.includes("ALTER TABLE"))
        .map((query) => env.DB.prepare(query)),
    );
    expect(await drainStorageOutbox(testEnv)).toBe(1);

    expect((await visit("localhost", link.slug)).status).toBe(410);
    expect(await env.LINKS.get("domain:go.example.com", "json")).toMatchObject({ disabled: true });
  });
});

describe("blocking hosts with a ban", () => {
  it("lists the hosts, blocks only the ones picked, and never a site everyone uses", async () => {
    const owner = await freeOwnerCookie();
    await createLink(owner, "https://kit-7ae5.up.railway.app/login");
    await createLink(owner, "https://www.google.com/maps");
    await createLink(owner, "https://other.example/x");
    const cookie = await adminCookie();

    expect(await jsonBody(await api("/admin/users/free-1/hosts", cookie))).toEqual([
      { host: "google.com", blockable: false },
      { host: "kit-7ae5.up.railway.app", blockable: true },
      { host: "other.example", blockable: true },
    ]);

    const res = await ban(cookie, {
      reason: "phishing",
      // google.com is never blocked, and unrelated.example is not theirs.
      blockHosts: ["kit-7ae5.up.railway.app", "google.com", "unrelated.example"],
    });
    expect(await jsonBody(res)).toMatchObject({ hostsBlocked: 1 });
    const blocked = await env.DB.prepare("select host from blocked_hosts").all<{ host: string }>();
    expect(blocked.results.map((r) => r.host)).toEqual(["kit-7ae5.up.railway.app"]);
  });

  it("blocks nothing unless asked", async () => {
    const owner = await freeOwnerCookie();
    await createLink(owner, "https://kit.up.railway.app/");
    await ban(await adminCookie(), { reason: "phishing" });
    expect((await row("select count(*) as n from blocked_hosts"))?.n).toBe(0);
  });

  it("refuses a site everyone uses on the blocklist page too", async () => {
    await freeOwnerCookie();
    const res = await api("/admin/links/blocked-hosts", await adminCookie(), {
      method: "POST",
      body: JSON.stringify({ host: "docs.google.com", reason: "x" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("the purge", () => {
  it(`deletes an org ${BAN_PURGE_AFTER_DAYS} days after its owner's ban, and not a day before`, async () => {
    await freeOwnerCookie();
    await ban(await adminCookie(), { reason: "phishing" });
    const bannedAt = Number((await row("select disabled_at as at from orgs"))?.at);

    const early = bannedAt + (BAN_PURGE_AFTER_DAYS - 1) * DAY_MS;
    expect(await purgeBannedOrgs(testEnv, db(), early)).toBe(0);
    expect((await row("select deleting_at as at from orgs"))?.at).toBeNull();

    const due = bannedAt + (BAN_PURGE_AFTER_DAYS + 1) * DAY_MS;
    expect(await purgeBannedOrgs(testEnv, db(), due)).toBe(1);
    expect((await row("select deleting_at as at from orgs"))?.at).not.toBeNull();
    // The account stays, banned, so the address cannot sign up again.
    expect((await row("select banned from user where id = 'free-1'"))?.banned).toBe(1);
  });

  it("leaves an org the purge has started on disabled when its owner is unbanned", async () => {
    await freeOwnerCookie();
    const cookie = await adminCookie();
    await ban(cookie, { reason: "phishing" });
    await env.DB.prepare("update orgs set deleting_at = 1 where id = 'org-1'").run();

    await unban(cookie);
    expect((await row("select disabled_at as at from orgs"))?.at).not.toBeNull();
    const audit = await row("select detail from admin_actions where action = 'user.unban'");
    expect(JSON.parse(String(audit?.detail))).toEqual({ orgsRestored: 0 });
  });

  it("leaves an unbanned org alone", async () => {
    await freeOwnerCookie();
    const cookie = await adminCookie();
    await ban(cookie, { reason: "phishing" });
    await unban(cookie);
    expect(await purgeBannedOrgs(testEnv, db(), Date.now() + 365 * DAY_MS)).toBe(0);
  });
});
