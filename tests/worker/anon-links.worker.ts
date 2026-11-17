import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overrideEnv,
  fillFreePlanLinks,
  recordingLimit,
  rateLimits,
} from "./support";
import { claimAnonLink, sweepExpiredAnonLinks } from "../../src/worker/routes/shorten";
import { publishLink } from "../../src/worker/kv";

const HOUR = 60 * 60 * 1000;

async function seedAnon(overrides: Partial<{ slug: string; expiresAt: number }> = {}) {
  const row = {
    id: `anon-${Math.random().toString(36).slice(2)}`,
    slug: overrides.slug ?? `s${Math.random().toString(36).slice(2, 8)}`,
    destination: "https://example.com/anon",
    claimToken: `tok-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
    expiresAt: overrides.expiresAt ?? Date.now() + 24 * HOUR,
  };
  await env.DB.prepare(
    `insert into anon_links (id, slug, destination, claim_token, created_at, expires_at)
     values (?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.slug, row.destination, row.claimToken, row.createdAt, row.expiresAt)
    .run();
  return row;
}

const countIn = async (table: "links" | "anon_links", slug: string) =>
  Number(
    (
      await env.DB.prepare(`select count(*) as n from ${table} where slug = ?`)
        .bind(slug)
        .first<{ n: number }>()
    )?.n ?? 0,
  );

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});

describe("claiming", () => {
  it("moves the link into the org and removes the anonymous row", async () => {
    await freeOwnerCookie();
    const anon = await seedAnon();

    const link = await claimAnonLink(authEnv(), "org-1", "free-1", anon.claimToken);
    expect(link?.slug).toBe(anon.slug);
    expect(link?.orgId).toBe("org-1");
    expect(await countIn("links", anon.slug)).toBe(1);
    expect(await countIn("anon_links", anon.slug)).toBe(0);
  });

  it("scores a link whose anonymous scan never finished", async () => {
    // Scoring runs after the response, in waitUntil. A claim landing first
    // deleted the only row that task can update, leaving the link unscored for good.
    await freeOwnerCookie();
    const anon = await seedAnon();
    expect(
      (
        await env.DB.prepare("select risk_checked_at as c from anon_links where id = ?")
          .bind(anon.id)
          .first<{ c: number | null }>()
      )?.c,
    ).toBeNull();

    const link = await claimAnonLink(authEnv(), "org-1", "free-1", anon.claimToken);

    const scored = await env.DB.prepare("select risk_checked_at as c from links where id = ?")
      .bind(link!.id)
      .first<{ c: number | null }>();
    expect(scored?.c).not.toBeNull();
  });

  it("refuses a token that was already spent, so one link is claimed once", async () => {
    await freeOwnerCookie();
    const anon = await seedAnon();
    expect(await claimAnonLink(authEnv(), "org-1", "free-1", anon.claimToken)).not.toBeNull();
    expect(await claimAnonLink(authEnv(), "org-1", "free-1", anon.claimToken)).toBeNull();
    expect(await countIn("links", anon.slug)).toBe(1);
  });

  it("refuses an expired link", async () => {
    await freeOwnerCookie();
    const anon = await seedAnon({ expiresAt: Date.now() - HOUR });
    expect(await claimAnonLink(authEnv(), "org-1", "free-1", anon.claimToken)).toBeNull();
    expect(await countIn("links", anon.slug)).toBe(0);
  });

  it("refuses a token nobody issued, the same way it refuses a spent one", async () => {
    // Identical answers on purpose: probing must not reveal which tokens are
    // real and merely used.
    await freeOwnerCookie();
    expect(await claimAnonLink(authEnv(), "org-1", "free-1", "made-up")).toBeNull();
  });

  it("needs a session, since the route is org-scoped", async () => {
    await freeOwnerCookie();
    const anon = await seedAnon();
    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claimToken: anon.claimToken }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await countIn("anon_links", anon.slug)).toBe(1);
  });

  it("refuses a member of another org", async () => {
    const cookie = await freeOwnerCookie();
    const anon = await seedAnon();
    await env.DB.prepare(
      "insert into orgs (id, name, created_at) values ('org-2','Other',0)",
    ).run();

    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-2/links/claim", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ claimToken: anon.claimToken }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await countIn("anon_links", anon.slug)).toBe(1);
  });
});

describe("the plan's link cap", () => {
  it("refuses a claim that would push the org past its limit", async () => {
    // Claiming goes through the same guarded insert as any link. Without it an
    // org one link under its cap could take ten from the landing page.
    await freeOwnerCookie();
    const anon = await seedAnon();

    await fillFreePlanLinks();

    expect(await claimAnonLink(authEnv(), "org-1", "free-1", anon.claimToken)).toBeNull();
    expect(await countIn("anon_links", anon.slug)).toBe(1);
    expect(await countIn("links", anon.slug)).toBe(0);
  });
});

describe("the sweep", () => {
  it("removes expired links and leaves live ones alone", async () => {
    const dead = await seedAnon({ expiresAt: Date.now() - HOUR });
    const live = await seedAnon();

    expect(await sweepExpiredAnonLinks(authEnv())).toBe(1);
    expect(await countIn("anon_links", dead.slug)).toBe(0);
    expect(await countIn("anon_links", live.slug)).toBe(1);
  });

  it("leaves the redirect alone when a claim took the slug over first", async () => {
    // The race compare-and-delete is for: a claim republishes the slug under the
    // org link's id after the sweep selected the row, and the sweep then deletes
    // that key, leaving the link resolving to nothing. Staged by rewriting the key.
    const anon = await seedAnon({ expiresAt: Date.now() - HOUR });
    await env.LINKS.put(
      `slug:${anon.slug}`,
      JSON.stringify({
        linkId: "link-owned-by-the-org",
        addressId: "addr-1",
        orgId: "org-1",
        url: anon.destination,
        expiresAt: null,
      }),
    );

    await sweepExpiredAnonLinks(authEnv());

    expect(await countIn("anon_links", anon.slug)).toBe(0);
    const still = await env.LINKS.get(`slug:${anon.slug}`);
    expect(still).not.toBeNull();
    expect(JSON.parse(still!).linkId).toBe("link-owned-by-the-org");
  });

  it("still drops the redirect it does own", async () => {
    const anon = await seedAnon({ expiresAt: Date.now() - HOUR });
    await env.LINKS.put(
      `slug:${anon.slug}`,
      JSON.stringify({
        linkId: anon.id,
        addressId: anon.id,
        orgId: "",
        url: anon.destination,
        expiresAt: anon.expiresAt,
      }),
    );

    await sweepExpiredAnonLinks(authEnv());

    expect(await env.LINKS.get(`slug:${anon.slug}`)).toBeNull();
    expect(await countIn("anon_links", anon.slug)).toBe(0);
  });

  it("never touches a real link", async () => {
    // Why these live in their own table: the delete job cannot see real links.
    const cookie = await freeOwnerCookie();
    const created = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://example.com/real" }),
      }),
    );
    const { slug } = await jsonBody<{ slug: string }>(created);

    await seedAnon({ expiresAt: Date.now() - HOUR });
    await sweepExpiredAnonLinks(authEnv());
    expect(await countIn("links", slug)).toBe(1);
  });
});

// A total only: there is no org, so nothing may land in the clicks table.
describe("the click total", () => {
  async function publishAnon(anon: Awaited<ReturnType<typeof seedAnon>>) {
    await publishLink(
      authEnv(),
      {
        id: anon.id,
        addressId: anon.id,
        orgId: "",
        slug: anon.slug,
        destination: anon.destination,
        expiresAt: anon.expiresAt,
        utmSource: "",
        utmMedium: "",
        utmCampaign: "",
        utmTerm: "",
        utmContent: "",
      },
      null,
    );
  }
  const clicksFor = (token: string) =>
    fetchWorker(
      new Request("http://localhost/api/shorten/clicks", { headers: { "x-claim-token": token } }),
    );

  it("counts each redirect and tells only the maker", async () => {
    const anon = await seedAnon();
    await publishAnon(anon);
    // Open, so the limit does not decide it, and
    // recording, so the budget is shown to be this link's own.
    const keys: string[] = [];
    const testEnv = { ...authEnv(), ...rateLimits({ click: recordingLimit(keys) }) };
    for (let i = 0; i < 2; i++) {
      const res = await fetchWorker(
        new Request(`http://localhost/${anon.slug}`, { redirect: "manual" }),
        testEnv,
      );
      expect(res.status).toBe(302);
    }
    expect(keys).toEqual([`click:org:anon:${anon.id}`, `click:org:anon:${anon.id}`]);

    const res = await clicksFor(anon.claimToken);
    expect(res.status).toBe(200);
    expect(await jsonBody<{ clicks: number }>(res)).toEqual({ clicks: 2 });

    const clickRows = await env.DB.prepare("select count(*) as n from clicks").first<{
      n: number;
    }>();
    expect(clickRows?.n).toBe(0);
  });

  it("answers an unknown or expired token with the same 404", async () => {
    const expired = await seedAnon({ expiresAt: Date.now() - HOUR });
    expect((await clicksFor("tok-nobody")).status).toBe(404);
    expect((await clicksFor(expired.claimToken)).status).toBe(404);
  });

  it("throttles one caller before reading D1, and asks nothing of a request with no token (security #11)", async () => {
    const anon = await seedAnon();
    const keys: string[] = [];
    let left = 1;
    let reads = 0;
    const real = env.DB;
    const DB: D1Database = {
      prepare: (query) => {
        reads++;
        return real.prepare(query);
      },
      batch: (statements) => {
        reads++;
        return real.batch(statements);
      },
      exec: (query) => real.exec(query),
      dump: () => real.dump(),
      withSession: (constraint) => real.withSession(constraint),
    };
    const testEnv = overrideEnv({
      DB,
      BETTER_AUTH_SECRET: authEnv().BETTER_AUTH_SECRET,
      ...rateLimits({
        anon_link: {
          limit: async ({ key }) => {
            keys.push(key);
            return { success: left-- > 0 };
          },
        },
      }),
    });
    const ask = (headers: HeadersInit = {}) =>
      fetchWorker(new Request("http://localhost/api/shorten/clicks", { headers }), testEnv);

    const none = await ask();
    expect(none.status).toBe(404);
    expect(keys).toHaveLength(0);
    expect(reads).toBe(0);

    const first = await ask({ "x-claim-token": anon.claimToken });
    expect(first.status).toBe(200);
    expect(await jsonBody<{ clicks: number }>(first)).toEqual({ clicks: 0 });
    const readsBefore = reads;

    expect((await ask({ "x-claim-token": anon.claimToken })).status).toBe(429);
    expect((await ask({ "x-claim-token": "tok-nobody" })).status).toBe(429);
    expect(reads).toBe(readsBefore);
    // Its own key, so polling never spends the budget for making links.
    expect(keys).toHaveLength(3);
    for (const key of keys) expect(key).toMatch(/^anon_link:clicks:[0-9a-f]{64}$/);
  });
});
