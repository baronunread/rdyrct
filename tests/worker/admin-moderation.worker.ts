import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import type { JsonValue } from "../../src/shared/types";
import { applyStorageMessage, syncLinkMsg, type StorageMessage } from "../../src/worker/storage";
import {
  adminCookie,
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  stubQueue,
  testEnv,
} from "./support";

/**
 * Admin link moderation (#67).
 *
 * The assertion that matters most is that a suspended link stays suspended
 * after a later edit. Suspension is enforced in desiredKvValue, which every
 * republish runs through; a check in the suspend route alone would be undone
 * by the next save, silently, and the link would be live again with nobody
 * having asked for it.
 */

async function createLink(cookie: string, destination = "https://example.com/one") {
  const res = await fetchWorker(
    new Request("http://localhost/api/orgs/org-1/links", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ destination }),
    }),
  );
  return await jsonBody<{ id: string; slug: string }>(res);
}

const admin = (path: string, cookie: string, init: RequestInit = {}) =>
  fetchWorker(
    new Request(`http://localhost/api/admin${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    }),
  );

/**
 * Storage messages ride a queue that nothing consumes in these tests, so a
 * publish only reaches KV when it is applied by hand. Applying it is also
 * exactly what proves the point: the route enqueues, and desiredKvValue is
 * what decides whether the key survives.
 */
async function syncKv(...slugs: string[]) {
  for (const slug of slugs)
    await applyStorageMessage(testEnv, drizzle(env.DB, { schema }), syncLinkMsg(slug, null));
}

/** What the redirect path would find: KV is the only thing that decides. */
const kvFor = (slug: string) => env.LINKS.get(`slug:${slug}`);
/** The key redirects: it carries a destination. */
const liveKey = async (slug: string) => (await kvFor(slug))?.includes('"url"') ?? false;
/** The key is held (#344): it answers "under review" and carries no
 * destination, so nothing on the redirect path can send anyone there. */
const heldKey = async (slug: string) => {
  const raw = await kvFor(slug);
  return raw !== null && raw.includes('"held":true') && !raw.includes('"url"');
};

/** Every live slug a link answers on. */
async function slugsOf(linkId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "select slug from link_addresses where link_id = ? and retired_at is null",
  )
    .bind(linkId)
    .all<{ slug: string }>();
  return results.map((r) => r.slug);
}

const realFetch = globalThis.fetch;

beforeEach(async () => {
  reset();
  await applyTestMigrations();
  // The destination scorer (#68) runs on create through waitUntil and would
  // otherwise reach the real resolver and write real scores, which the risk
  // sort test then has to fight.
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://security.cloudflare-dns.com")) throw new Error("offline");
    return realFetch(input, init);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Create a link and publish its keys, so KV reflects a live link. */
async function createLiveLink(cookie: string, destination?: string) {
  const link = await createLink(cookie, destination);
  await syncKv(...(await slugsOf(link.id)));
  return link;
}

/** Call a moderation route, then apply the republishes it enqueued. */
async function moderate(
  path: string,
  cookie: string,
  body?: JsonValue,
  linkIds: string[] = [],
  method: "POST" | "PATCH" = "POST",
) {
  const res = await admin(path, cookie, {
    method,
    body: JSON.stringify(body ?? {}),
  });
  for (const id of linkIds) await syncKv(...(await slugsOf(id)));
  return res;
}

/** Suspend or restore one link, and apply the republishes it enqueued. */
async function setSuspended(linkId: string, cookie: string, suspended: boolean, reason = "") {
  return moderate(`/links/${linkId}`, cookie, { suspended, reason }, [linkId], "PATCH");
}

describe("suspending one link", () => {
  it("stops the redirect and records who did it", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLiveLink(owner);
    expect(await liveKey(link.slug)).toBe(true);

    const cookie = await adminCookie();
    const res = await setSuspended(link.id, cookie, true, "phishing report #412");
    expect(res.status).toBe(200);
    expect(await heldKey(link.slug)).toBe(true);

    const audit = await jsonBody<{ action: string; targetId: string; detail: string | null }[]>(
      await admin("/audit", cookie),
    );
    const entry = audit.find((a) => a.action === "link.suspend");
    expect(entry?.targetId).toBe(link.id);
    expect(entry?.detail).toContain("phishing report #412");
  });

  it("keeps the row and its clicks: suspension is reversible, deletion is not", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLink(owner);
    await env.DB.prepare(
      "insert into clicks (link_id, org_id, ts, country, referrer, device) values (?, 'org-1', 0, 'US', '', 'desktop')",
    )
      .bind(link.id)
      .run();

    await setSuspended(link.id, await adminCookie(), true, "spam");

    const rows = await env.DB.prepare(
      "select (select count(*) from links where id = ?) as links, (select count(*) from clicks where link_id = ?) as clicks",
    )
      .bind(link.id, link.id)
      .first<{ links: number; clicks: number }>();
    expect(rows).toEqual({ links: 1, clicks: 1 });
  });

  it("comes back when unsuspended", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLiveLink(owner);
    const cookie = await adminCookie();

    await setSuspended(link.id, cookie, true, "spam");
    expect(await heldKey(link.slug)).toBe(true);

    await setSuspended(link.id, cookie, false);
    expect(await liveKey(link.slug)).toBe(true);
  });

  it("refuses a suspension with no reason", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLink(owner);
    const res = await admin(`/links/${link.id}`, await adminCookie(), {
      method: "PATCH",
      body: JSON.stringify({ suspended: true }),
    });
    expect(res.status).toBe(400);
  });
});

describe("suspension survives what would undo it", () => {
  it("stays dark after the owner edits the link", async () => {
    // The whole reason the check lives in desiredKvValue. An edit republishes
    // the key, and a suspension enforced anywhere else would be lifted by it.
    const owner = await freeOwnerCookie();
    const link = await createLiveLink(owner);
    await setSuspended(link.id, await adminCookie(), true, "malware");

    const res = await fetchWorker(
      new Request(`http://localhost/api/orgs/org-1/links/${link.id}`, {
        method: "PATCH",
        headers: { cookie: owner, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://example.com/changed" }),
      }),
    );
    expect(res.status).toBe(200);
    // The edit republished the key. It is still dark.
    await syncKv(...(await slugsOf(link.id)));
    expect(await heldKey(link.slug)).toBe(true);
  });

  it("stays dark on every address, not only the primary", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLiveLink(owner);
    const aliasRes = await fetchWorker(
      new Request(`http://localhost/api/orgs/org-1/links/${link.id}/addresses`, {
        method: "POST",
        headers: { cookie: owner, "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(aliasRes.status).toBe(201);
    const aliases = await env.DB.prepare(
      "select slug from link_addresses where link_id = ? and retired_at is null",
    )
      .bind(link.id)
      .all<{ slug: string }>();
    expect(aliases.results.length).toBe(2);

    await syncKv(...aliases.results.map((r) => r.slug));
    await setSuspended(link.id, await adminCookie(), true, "malware");

    for (const row of aliases.results) expect(await heldKey(row.slug)).toBe(true);
  });
});

describe("suspension does not wait on the queue (#101)", () => {
  /** A link answering on twelve slugs: past the ten keys a request writes
   * itself before handing a batch to the queue. */
  async function linkWithTwelveSlugs(owner: string) {
    const link = await createLiveLink(owner);
    for (let i = 0; i < 11; i++)
      await env.DB.prepare(
        "insert into link_addresses (id, link_id, org_id, slug, kind, created_at) values (?, ?, 'org-1', ?, 'permanent_alias', 0)",
      )
        .bind(`addr-extra-${i}`, link.id, `extra${i}`)
        .run();
    const slugs = await slugsOf(link.id);
    expect(slugs.length).toBe(12);
    await syncKv(...slugs);
    for (const slug of slugs) expect(await liveKey(slug)).toBe(true);
    return { link, slugs };
  }

  /** Suspend or restore through a queue that delivers nothing, and return
   * what it was handed. KV is never synced by hand here. */
  async function patchWithDeadQueue(cookie: string, linkId: string, body: JsonValue) {
    const sent: StorageMessage[] = [];
    const res = await fetchWorker(
      new Request(`http://localhost/api/admin/links/${linkId}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { ...authEnv(), STORAGE_QUEUE: stubQueue<StorageMessage>((m) => sent.push(m)) },
    );
    expect(res.status).toBe(200);
    return sent;
  }

  it("holds every slug in the request, and restores them the same way", async () => {
    const { link, slugs } = await linkWithTwelveSlugs(await freeOwnerCookie());
    const cookie = await adminCookie();

    await patchWithDeadQueue(cookie, link.id, { suspended: true, reason: "phishing" });
    for (const slug of slugs) expect(await heldKey(slug)).toBe(true);

    await patchWithDeadQueue(cookie, link.id, { suspended: false });
    for (const slug of slugs) expect(await liveKey(slug)).toBe(true);
  });

  it("puts the hold back when a racing edit writes a stale live value", async () => {
    const { link, slugs } = await linkWithTwelveSlugs(await freeOwnerCookie());
    const cookie = await adminCookie();
    const live = await kvFor(slugs[0]!);

    const sent = await patchWithDeadQueue(cookie, link.id, { suspended: true, reason: "phishing" });
    // An owner's edit that read D1 before the suspension committed, landing
    // its KV write after ours.
    await env.LINKS.put(`slug:${slugs[0]}`, live!);
    expect(await liveKey(slugs[0]!)).toBe(true);

    // The delayed recheck the route queued reads D1 again.
    expect(sent.map((m) => m.op === "kv_sync" && m.key).sort()).toEqual(
      slugs.map((s) => `slug:${s}`).sort(),
    );
    const db = drizzle(env.DB, { schema });
    for (const message of sent) await applyStorageMessage(testEnv, db, message);
    expect(await heldKey(slugs[0]!)).toBe(true);
  });
});

describe("suspending a whole org", () => {
  it("takes every link down without deleting the org", async () => {
    const owner = await freeOwnerCookie();
    const a = await createLiveLink(owner, "https://example.com/a");
    const b = await createLiveLink(owner, "https://example.com/b");

    const res = await moderate(
      "/links/orgs/org-1/suspend",
      await adminCookie(),
      { reason: "account compromised" },
      [a.id, b.id],
    );
    expect(await res.json()).toEqual({ count: 2 });
    expect(await heldKey(a.slug)).toBe(true);
    expect(await heldKey(b.slug)).toBe(true);

    const org = await env.DB.prepare("select count(*) as n from orgs where id = 'org-1'").first<{
      n: number;
    }>();
    expect(org?.n).toBe(1);
  });

  it("suspends a big org in a fixed number of round trips", async () => {
    // One address query and one queue send per link is fine for two links
    // and fatal for three thousand: it asked D1 for 3,002 statements and
    // made 3,000 sends, past both D1's 1,000-query invocation limit and the
    // subrequest ceiling. The request died after the suspension flag was
    // committed, so the links read as suspended and the ones whose messages
    // never went out kept redirecting.
    //
    // Counted rather than sized: running 3,000 links here would test the
    // fixture, not the route. What matters is that the cost stops growing
    // with the number of links.
    const owner = await freeOwnerCookie();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++)
      ids.push((await createLiveLink(owner, `https://example.com/b${i}`)).id);

    let sends = 0;
    const realSendBatch = env.STORAGE_QUEUE.sendBatch.bind(env.STORAGE_QUEUE);
    env.STORAGE_QUEUE.sendBatch = async (batch, options) => {
      sends++;
      const messages = [...batch];
      expect(messages.length).toBeLessThanOrEqual(100);
      return realSendBatch(messages, options);
    };

    try {
      const res = await admin("/links/orgs/org-1/suspend", await adminCookie(), {
        method: "POST",
        body: JSON.stringify({ reason: "account compromised" }),
      });
      expect(await res.json()).toEqual({ count: 12 });
    } finally {
      env.STORAGE_QUEUE.sendBatch = realSendBatch;
    }

    // Twelve links, one send. Per link it would have been twelve.
    expect(sends).toBe(1);
  });

  it("restores them all again", async () => {
    const owner = await freeOwnerCookie();
    const a = await createLiveLink(owner, "https://example.com/a");
    const cookie = await adminCookie();
    await moderate("/links/orgs/org-1/suspend", cookie, { reason: "checking" }, [a.id]);
    await moderate("/links/orgs/org-1/suspend?suspend=0", cookie, {}, [a.id]);
    expect(await liveKey(a.slug)).toBe(true);
  });
});

describe("the cross-org search", () => {
  it("filters by organization in the query, not in the browser", async () => {
    // The page used to narrow the rows this endpoint had already capped at
    // 200. "Show me this organization's links" therefore meant "show me
    // whichever of its links are in the newest 200 across the whole
    // instance", which for a busy instance is usually none of them: an abuse
    // report naming an org was answered with an empty table.
    const owner = await freeOwnerCookie();
    await createLink(owner, "https://example.com/mine");

    const cookie = await adminCookie();
    const mine = await jsonBody<{ orgId: string; slug: string; url: string }[]>(
      await admin("/links?org=org-1", cookie),
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.orgId === "org-1")).toBe(true);
    // A shared link shows its host, not a bare "/slug".
    expect(mine[0]!.url).toBe(`https://${env.SHARED_LINK_HOST}/${mine[0]!.slug}`);

    const other = await jsonBody<unknown[]>(await admin("/links?org=org-nobody", cookie));
    expect(other).toEqual([]);
  });

  it("finds a link by destination, which is what an abuse report names", async () => {
    const owner = await freeOwnerCookie();
    await createLink(owner, "https://phishy.example/login");
    await createLink(owner, "https://legit.example/docs");

    const rows = await jsonBody<{ destination: string; orgName: string }[]>(
      await admin("/links?q=phishy.example", await adminCookie()),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].destination).toContain("phishy.example");
    expect(rows[0].orgName).toBe("Test");
  });

  it("sorts by risk with unscored last, since unscored is not safe", async () => {
    const owner = await freeOwnerCookie();
    const clean = await createLink(owner, "https://clean.example/a");
    const bad = await createLink(owner, "https://bad.example/b");
    await createLink(owner, "https://unknown.example/c");
    await env.DB.prepare("update links set risk_score = 0 where id = ?").bind(clean.id).run();
    await env.DB.prepare("update links set risk_score = 100 where id = ?").bind(bad.id).run();
    // Explicitly unscored, so the assertion is about ordering rather than
    // about whatever the scorer happened to do.
    await env.DB.prepare("update links set risk_score = null where id not in (?, ?)")
      .bind(clean.id, bad.id)
      .run();

    const rows = await jsonBody<{ riskScore: number | null }[]>(
      await admin("/links?sort=risk", await adminCookie()),
    );
    expect(rows.map((r) => r.riskScore)).toEqual([100, 0, null]);
  });

  it("can show only what is suspended", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLink(owner);
    await createLink(owner, "https://example.com/other");
    const cookie = await adminCookie();
    await setSuspended(link.id, cookie, true, "spam");

    const rows = await jsonBody<{ id: string }[]>(await admin("/links?suspended=1", cookie));
    expect(rows.map((r) => r.id)).toEqual([link.id]);
  });

  it("can show only what is active", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLink(owner);
    const other = await createLink(owner, "https://example.com/other");
    const cookie = await adminCookie();
    await setSuspended(link.id, cookie, true, "spam");

    const rows = await jsonBody<{ id: string }[]>(await admin("/links?suspended=0", cookie));
    expect(rows.map((r) => r.id)).toEqual([other.id]);
  });
});

describe("restoring several links at once", () => {
  it("restores each selected link and audits each one", async () => {
    const owner = await freeOwnerCookie();
    const a = await createLiveLink(owner, "https://example.com/a");
    const b = await createLiveLink(owner, "https://example.com/b");
    const cookie = await adminCookie();
    await setSuspended(a.id, cookie, true, "spam");
    await setSuspended(b.id, cookie, true, "spam");

    const res = await admin("/links/restore", cookie, {
      method: "POST",
      body: JSON.stringify({ ids: [a.id, b.id] }),
    });
    expect(await jsonBody<{ count: number }>(res)).toEqual({ count: 2 });
    await syncKv(a.slug, b.slug);
    expect(await liveKey(a.slug)).toBe(true);
    expect(await liveKey(b.slug)).toBe(true);
    const { results } = await env.DB.prepare(
      "select count(*) as n from admin_actions where action = 'link.unsuspend'",
    ).all<{ n: number }>();
    expect(results[0].n).toBe(2);
  });

  it("clears the org so the sweep does not undo the restore", async () => {
    const owner = await freeOwnerCookie();
    const a = await createLiveLink(owner, "https://example.com/a");
    const cookie = await adminCookie();
    await moderate("/links/orgs/org-1/suspend", cookie, { reason: "sweep" }, [a.id]);
    await admin("/links/restore", cookie, {
      method: "POST",
      body: JSON.stringify({ ids: [a.id] }),
    });
    const org = await env.DB.prepare("select cleared_at as at from orgs where id = 'org-1'").first<{
      at: number | null;
    }>();
    expect(org?.at).not.toBeNull();
  });

  it("lifts the org's write block once none of its links is suspended", async () => {
    const owner = await freeOwnerCookie();
    const a = await createLiveLink(owner, "https://example.com/a");
    const b = await createLiveLink(owner, "https://example.com/b");
    const cookie = await adminCookie();
    await moderate("/links/orgs/org-1/suspend", cookie, { reason: "sweep" }, [a.id, b.id]);
    const blocked = () =>
      env.DB.prepare("select links_suspended_at as at from orgs where id = 'org-1'")
        .first<{ at: number | null }>()
        .then((r) => r?.at ?? null);

    await setSuspended(a.id, cookie, false);
    expect(await blocked(), "one link is still suspended").not.toBeNull();
    await setSuspended(b.id, cookie, false);
    expect(await blocked()).toBeNull();
  });

  it("does not switch off the automatic checks for an org that was never suspended whole", async () => {
    const owner = await freeOwnerCookie();
    const a = await createLiveLink(owner, "https://example.com/a");
    const cookie = await adminCookie();
    await setSuspended(a.id, cookie, true, "one bad link");
    await setSuspended(a.id, cookie, false);
    const org = await env.DB.prepare("select cleared_at as at from orgs where id = 'org-1'").first<{
      at: number | null;
    }>();
    expect(org?.at).toBeNull();
  });

  it("refuses an empty selection", async () => {
    const res = await admin("/links/restore", await adminCookie(), {
      method: "POST",
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("deleting a user as an admin", () => {
  it("takes the organizations they own with them instead of refusing", async () => {
    await freeOwnerCookie();
    const cookie = await adminCookie();

    const res = await admin("/users/free-1", cookie, { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await jsonBody<{ orgsDeleted: number }>(res)).toMatchObject({ orgsDeleted: 1 });
    const user = await env.DB.prepare("select count(*) as n from user where id = 'free-1'").first<{
      n: number;
    }>();
    expect(user?.n).toBe(0);
    // Flagged for teardown in the same batch that removed the account; the
    // workflow then deletes the org itself (a row may already be gone).
    const org = await env.DB.prepare(
      "select deleting_at as at from orgs where id = 'org-1'",
    ).first<{
      at: number | null;
    }>();
    expect(org === null || org.at !== null).toBe(true);
  });

  it("404s for a user that does not exist, and will not delete the caller", async () => {
    const cookie = await adminCookie();
    expect((await admin("/users/nobody", cookie, { method: "DELETE" })).status).toBe(404);
    expect((await admin("/users/admin-1", cookie, { method: "DELETE" })).status).toBe(400);
  });
});

describe("who may reach any of this", () => {
  it("404s for a signed-in non-admin, so the route does not announce itself", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLiveLink(owner);
    for (const [path, init] of [
      ["/links", {}],
      ["/links/anonymous", {}],
      ["/links/reports", {}],
      ["/links/restore", { method: "POST", body: JSON.stringify({ ids: [link.id] }) }],
      ["/links/reports/x/dismiss", { method: "POST" }],
      ["/links/orgs/org-1/reviewed", { method: "POST" }],
      ["/audit", {}],
      [
        `/links/${link.id}`,
        { method: "PATCH", body: JSON.stringify({ suspended: true, reason: "x" }) },
      ],
    ] as const) {
      const res = await admin(path, owner, init);
      expect(res.status, `${path} should 404 for a non-admin`).toBe(404);
    }
    // And nothing happened to the link.
    expect(await liveKey(link.slug)).toBe(true);
  });

  it("404s for a signed-out caller", async () => {
    const res = await fetchWorker(
      new Request("http://localhost/api/admin/links", { headers: {} }),
      authEnv(),
    );
    expect([401, 404]).toContain(res.status);
  });
});
