import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  testDb,
} from "./support";
import { allocateSharedSlug } from "../../src/worker/shared-slugs";
import { sweepExpiredAnonLinks } from "../../src/worker/routes/shorten";
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
  reset();
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
  });

  it("after an anonymous link expires and is swept", async () => {
    const res = await shorten("https://example.com/anon");
    expect(res.status).toBe(201);
    const { slug } = await jsonBody<{ slug: string }>(res);
    expect(await issued(slug)).toBe(true);

    await env.DB.prepare("update anon_links set expires_at = ? where slug = ?")
      .bind(Date.now() - HOUR, slug)
      .run();
    expect(await sweepExpiredAnonLinks(authEnv())).toBe(1);
    expect(await allocateSharedSlug(testDb(), drawing(slug, "fresh04"))).toBe("fresh04");
  });

  it("while an anonymous link still holds it, for an org link too", async () => {
    // The old org-link check read only link_addresses, so a draw that hit a
    // live anonymous slug was accepted and overwrote its redirect.
    const { slug } = await jsonBody<{ slug: string }>(await shorten("https://example.com/live"));
    expect(await allocateSharedSlug(testDb(), drawing(slug, "fresh05"))).toBe("fresh05");
  });
});
