import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  authEnv,
  fetchWorker,
  fillFreePlanLinks,
  freeOwnerCookie,
  jsonBody,
  rawAddressRow,
  rawLinkRow,
  testDb,
} from "./support";
import { allocateSharedSlug } from "../../src/worker/shared-slugs";
import { insertLinkWithinLimit } from "../../src/worker/plan";
import { claimAnonLink, sweepExpiredAnonLinks } from "../../src/worker/routes/shorten";
import type { JsonValue } from "../../src/shared/types";

/**
 * A shared-domain slug is handed out once, ever.
 *
 * A deleted link's slug lives on in old posts, emails and printed QR codes.
 * Handing it to somebody else points all of those wherever they choose,
 * which is how dead bit.ly links in old brand tweets came to preview pages
 * their owners never linked. Each test below frees a slug the way the app
 * does, then forces the allocator to draw it again.
 */

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});

/** Draws the given slugs in order, then fails the test if asked again. */
function drawing(...slugs: string[]) {
  const queue = [...slugs];
  return () => {
    const next = queue.shift();
    if (!next) throw new Error("the allocator drew more slugs than the test planned");
    return next;
  };
}

const issued = async (slug: string) =>
  !!(await env.DB.prepare("select 1 from issued_slugs where slug = ?").bind(slug).first());

function orgApi(cookie: string, method: string, path: string, body?: JsonValue) {
  return fetchWorker(
    new Request(`http://localhost/api/orgs/org-1${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

function shorten(destination: string) {
  return fetchWorker(
    new Request("http://localhost/api/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination }),
    }),
  );
}

describe("allocateSharedSlug", () => {
  it("records the slug it hands out", async () => {
    const slug = await allocateSharedSlug(testDb(), drawing("fresh01"));
    expect(slug).toBe("fresh01");
    expect(await issued("fresh01")).toBe(true);
  });

  it("skips a slug issued before and draws again", async () => {
    await allocateSharedSlug(testDb(), drawing("taken01"));
    expect(await allocateSharedSlug(testDb(), drawing("taken01", "fresh02"))).toBe("fresh02");
  });

  it("gives up after five clashes rather than looping", async () => {
    await allocateSharedSlug(testDb(), drawing("taken02"));
    const always = () => "taken02";
    await expect(allocateSharedSlug(testDb(), always)).rejects.toMatchObject({ status: 503 });
  });
});

describe("a link made without an account", () => {
  // Temporary, slug included: the landing page says so. An account's links,
  // free plan too, keep theirs for good.
  const expire = (slug: string) =>
    env.DB.prepare("update anon_links set expires_at = ? where slug = ?")
      .bind(Date.now() - HOUR, slug)
      .run();

  it("gives its slug back once it expires unclaimed", async () => {
    const res = await shorten("https://example.com/anon");
    expect(res.status).toBe(201);
    const { slug } = await jsonBody<{ slug: string }>(res);
    expect(await issued(slug)).toBe(true);

    await expire(slug);
    expect(await sweepExpiredAnonLinks(authEnv())).toBe(1);
    expect(await issued(slug)).toBe(false);
    expect(await allocateSharedSlug(testDb(), drawing(slug))).toBe(slug);
  });

  it("keeps its slug for good once an account claims it", async () => {
    await freeOwnerCookie();
    const { slug, claimToken } = await jsonBody<{ slug: string; claimToken: string }>(
      await shorten("https://example.com/claimed"),
    );
    const link = await claimAnonLink(authEnv(), "org-1", "free-1", claimToken);
    expect(link?.slug).toBe(slug);

    await env.DB.prepare("delete from links where id = ?").bind(link!.id).run();
    expect(await issued(slug)).toBe(true);
    expect(await allocateSharedSlug(testDb(), drawing(slug, "fresh04"))).toBe("fresh04");
  });

  it("reserves the slug again when a claim lands after the sweep freed it", async () => {
    // The other order of the race: the claim passed its expiry check, the
    // sweep then freed the slug, and only then does the claim's insert run.
    await freeOwnerCookie();
    const { slug } = await jsonBody<{ slug: string }>(await shorten("https://example.com/late"));
    await expire(slug);
    await sweepExpiredAnonLinks(authEnv());
    expect(await issued(slug)).toBe(false);

    const inserted = await insertLinkWithinLimit(
      testDb(),
      authEnv(),
      rawLinkRow({
        id: "link-late",
        orgId: "org-1",
        slug,
        destination: "https://example.com/late",
        createdAt: Date.now(),
      }),
      rawAddressRow({
        id: "addr-late",
        linkId: "link-late",
        orgId: "org-1",
        slug,
        kind: "primary",
        createdAt: Date.now(),
      }),
      30,
    );
    expect(inserted).toBe(true);
    expect(await issued(slug)).toBe(true);
  });

  it("never frees a slug an account's link holds, even if the sweep races a claim", async () => {
    // Staged: the sweep's anonymous row is still there, expired, while an
    // organization link already answers on the same slug.
    await freeOwnerCookie();
    const { slug } = await jsonBody<{ slug: string }>(await shorten("https://example.com/race"));
    await env.DB.batch([
      env.DB.prepare(
        `insert into links (id, org_id, slug, destination, created_at)
         values ('link-race', 'org-1', ?, 'https://example.com/race', 0)`,
      ).bind(slug),
      env.DB.prepare(
        `insert into link_addresses (id, link_id, org_id, slug, kind, created_at)
         values ('addr-race', 'link-race', 'org-1', ?, 'primary', 0)`,
      ).bind(slug),
    ]);
    await expire(slug);

    await sweepExpiredAnonLinks(authEnv());
    expect(await issued(slug)).toBe(true);
  });
});

describe("a refused create", () => {
  it("issues no slug, so retrying at the cap does not grow the table", async () => {
    const cookie = await freeOwnerCookie();
    await fillFreePlanLinks();
    const count = async () =>
      (await env.DB.prepare("select count(*) as n from issued_slugs").first<{ n: number }>())?.n;
    const before = await count();

    const res = await orgApi(cookie, "POST", "/links", {
      destination: "https://example.com/one-more",
    });
    expect(res.status).toBe(402);
    expect(await count()).toBe(before);
  });
});

describe("a slug never comes back", () => {
  it("after its link is deleted", async () => {
    const cookie = await freeOwnerCookie();
    const created = await orgApi(cookie, "POST", "/links", {
      destination: "https://example.com/brand",
    });
    expect(created.status).toBe(201);
    const { id, slug } = await jsonBody<{ id: string; slug: string }>(created);
    expect(await issued(slug)).toBe(true);

    expect((await orgApi(cookie, "DELETE", `/links/${id}`)).status).toBe(200);
    expect(await issued(slug)).toBe(true);
    expect(await allocateSharedSlug(testDb(), drawing(slug, "fresh03"))).toBe("fresh03");
  });

  it("after its whole organization is deleted", async () => {
    // Org teardown cascades the links and their addresses away; the record
    // of the slug has no org to cascade from.
    const cookie = await freeOwnerCookie();
    const { slug } = await jsonBody<{ slug: string }>(
      await orgApi(cookie, "POST", "/links", { destination: "https://example.com/gone" }),
    );
    await env.DB.prepare("delete from orgs where id = 'org-1'").run();
    expect(await issued(slug)).toBe(true);
    expect(await allocateSharedSlug(testDb(), drawing(slug, "fresh06"))).toBe("fresh06");
  });

  it("after an extra address is removed, which retires it without deleting anything", async () => {
    const cookie = await freeOwnerCookie();
    const { id } = await jsonBody<{ id: string }>(
      await orgApi(cookie, "POST", "/links", { destination: "https://example.com/aliased" }),
    );
    const added = await orgApi(cookie, "POST", `/links/${id}/addresses`, {});
    expect(added.status).toBe(201);
    // The route answers with the link; the new address is its alias row.
    const alias = (await env.DB.prepare(
      "select id, slug from link_addresses where link_id = ? and kind = 'permanent_alias'",
    )
      .bind(id)
      .first<{ id: string; slug: string }>())!;
    expect(await issued(alias.slug)).toBe(true);

    expect((await orgApi(cookie, "DELETE", `/links/${id}/addresses/${alias.id}`)).status).toBe(200);
    expect(await allocateSharedSlug(testDb(), drawing(alias.slug, "fresh07"))).toBe("fresh07");
  });

  it("while an anonymous link still holds it, for an org link too", async () => {
    // The old org-link check read only link_addresses, so a draw that hit a
    // live anonymous slug was accepted and overwrote its redirect.
    const { slug } = await jsonBody<{ slug: string }>(await shorten("https://example.com/live"));
    expect(await allocateSharedSlug(testDb(), drawing(slug, "fresh05"))).toBe("fresh05");
  });
});
