import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import type { JsonValue } from "../../src/shared/types";
import { applyStorageMessage, syncLinkMsg } from "../../src/worker/storage";
import {
  adminCookie,
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
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
    expect(await kvFor(link.slug)).toBeTruthy();

    const cookie = await adminCookie();
    const res = await setSuspended(link.id, cookie, true, "phishing report #412");
    expect(res.status).toBe(200);
    expect(await kvFor(link.slug)).toBeNull();

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
    expect(await kvFor(link.slug)).toBeNull();

    await setSuspended(link.id, cookie, false);
    expect(await kvFor(link.slug)).toBeTruthy();
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
    expect(await kvFor(link.slug)).toBeNull();
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

    for (const row of aliases.results) expect(await kvFor(row.slug)).toBeNull();
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
    expect(await kvFor(a.slug)).toBeNull();
    expect(await kvFor(b.slug)).toBeNull();

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
    expect(await kvFor(a.slug)).toBeTruthy();
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
    const mine = await jsonBody<{ orgId: string }[]>(await admin("/links?org=org-1", cookie));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.orgId === "org-1")).toBe(true);

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
});

describe("who may reach any of this", () => {
  it("404s for a signed-in non-admin, so the route does not announce itself", async () => {
    const owner = await freeOwnerCookie();
    const link = await createLiveLink(owner);
    for (const [path, init] of [
      ["/links", {}],
      ["/links/anonymous", {}],
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
    expect(await kvFor(link.slug)).toBeTruthy();
  });

  it("404s for a signed-out caller", async () => {
    const res = await fetchWorker(
      new Request("http://localhost/api/admin/links", { headers: {} }),
      authEnv(),
    );
    expect([401, 404]).toContain(res.status);
  });
});
