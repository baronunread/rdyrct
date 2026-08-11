import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, authEnv, fetchWorker, freeOwnerCookie } from "./support";
import { claimAnonLink, sweepExpiredAnonLinks } from "../../src/worker/routes/shorten";

/**
 * Claiming an anonymous link, and letting go of one (Direction A of #96).
 *
 * The browser test covers making one, because that path runs the Cap
 * proof-of-work. These cover the rules a browser cannot show: what a stale,
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
  reset();
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

    // Fill the free plan's allowance with raw rows, each with the primary
    // address that makes it count.
    const statements = [];
    for (let i = 0; i < 30; i++) {
      statements.push(
        env.DB.prepare(
          `insert into links (id, org_id, slug, destination, title, utm_source, utm_medium,
             utm_campaign, utm_term, utm_content, qr_logo, qr_style, qr_color, qr_corner,
             qr_bg, qr_eye_color, created_at)
           values (?, 'org-1', ?, 'https://example.com', '', '', '', '', '', '', '', '', '', '', '', '', 0)`,
        ).bind(`full-${i}`, `full${i}`),
        env.DB.prepare(
          `insert into link_addresses (id, link_id, org_id, slug, kind, created_at)
           values (?, ?, 'org-1', ?, 'primary', 0)`,
        ).bind(`addr-${i}`, `full-${i}`, `full${i}`),
      );
    }
    await env.DB.batch(statements);

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
    const { slug } = (await created.json()) as { slug: string };

    await seedAnon({ expiresAt: Date.now() - HOUR });
    await sweepExpiredAnonLinks(authEnv());
    expect(await countIn("links", slug)).toBe(1);
  });
});
