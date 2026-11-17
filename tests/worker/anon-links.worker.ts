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

/**
 * Claiming an anonymous link, and letting go of one (Direction A of #96).
 *
 * The browser test covers making one, because that path runs the
 * Turnstile challenge. These cover the rules a browser cannot show: what a stale,
 * spent or expired claim token does, and that the sweep only ever touches
 * anonymous rows.
 */

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
    // Scoring an anonymous link runs after its response, in waitUntil. A
    // claim landing first used to copy four nulls and then delete the only
    // row that background task knows how to update, so the link stayed
    // unscored for good on the table moderation actually reads.
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
    // The claim runs behind requireOrgRole, so somebody signed in cannot
    // spend a token into an organization they do not belong to.
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
    // Claiming is still creating a link in somebody's organization, so it
    // goes through the same guarded insert as every other one. Without that
    // an org one link under its cap could take ten from the landing page.
    await freeOwnerCookie();
    const anon = await seedAnon();

    await fillFreePlanLinks();

    expect(await claimAnonLink(authEnv(), "org-1", "free-1", anon.claimToken)).toBeNull();
    // And the anonymous row survives, so the link keeps working until it
    // expires rather than vanishing into a refused claim.
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
    // The race the compare-and-delete is for: the sweep selects an expired
    // row, a claim lands before the sweep reaches it and republishes the
    // same slug under the organization link's id, and the sweep then
    // deletes that key. The link would sit in D1 resolving to nothing, and
    // the anonymous row that tells the next sweep to retry is gone too, so
    // nothing repairs it.
    //
    // Staged rather than raced: the row is left in place and its key
    // rewritten to another link's id, which is the state a mid-flight claim
    // produces.
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

    // The row goes, because it is spent. The redirect stays, because it is
    // no longer this row's.
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
    // The whole reason these live in their own table: a delete job that can
    // only see anonymous rows cannot reach anybody's actual links.
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

// The landing page shows "3 clicks so far" on the link a visitor made, so
// they have a reason to come back and keep it. A total only: there is no
// org, so nothing may land in the clicks table.
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
    // Every statement the route sends to D1, counted.
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

    // No token: the same 404, with no limiter call and no read.
    const none = await ask();
    expect(none.status).toBe(404);
    expect(keys).toHaveLength(0);
    expect(reads).toBe(0);

    // Within the limit, the maker still gets the count.
    const first = await ask({ "x-claim-token": anon.claimToken });
    expect(first.status).toBe(200);
    expect(await jsonBody<{ clicks: number }>(first)).toEqual({ clicks: 0 });
    const readsBefore = reads;

    // Past it: a 429, and D1 is never asked.
    expect((await ask({ "x-claim-token": anon.claimToken })).status).toBe(429);
    expect((await ask({ "x-claim-token": "tok-nobody" })).status).toBe(429);
    expect(reads).toBe(readsBefore);
    // Its own key, so polling never spends the budget for making links.
    expect(keys).toHaveLength(3);
    for (const key of keys) expect(key).toMatch(/^anon_link:clicks:[0-9a-f]{64}$/);
  });
});
