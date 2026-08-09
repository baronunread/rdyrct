import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import { ALIAS_TTL_MS } from "../../src/worker/util";
import type { Env } from "../../src/worker/env";
import {
  addressById,
  addressesOf,
  applyTestMigrations,
  authEnv,
  captureStorageQueue as captureQueue,
  freeOwnerCookie,
  overrideEnv,
  rawAddressRow,
  rawLinkRow,
  testDb as db,
} from "./support";

/** A free-plan owner of "org-1", with an active custom domain "go.example.com". */
const seed = () => freeOwnerCookie({ id: "domain-1", hostname: "go.example.com" });

async function apiWithEnv(
  testEnv: Env,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost/api/orgs/org-1${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const api = (cookie: string, method: string, path: string, body?: unknown) =>
  apiWithEnv(authEnv(), cookie, method, path, body);

async function createLink(cookie: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await api(cookie, "POST", "/links", body);
  return res.json() as Promise<{ id: string }>;
}

/** A custom-domain link renamed once, so it carries a live temp_alias: the
 * starting point for every test about what can be done to an alias. */
async function renamedLink() {
  const cookie = await seed();
  return { cookie, ...(await createRenamedLink(cookie)) };
}

async function createRenamedLink(cookie: string) {
  const { id } = await createLink(cookie, {
    destination: "https://example.com/a",
    domainId: "domain-1",
    slug: "old-slug",
  });
  await api(cookie, "PATCH", `/links/${id}`, { slug: "new-slug" });
  const alias = (await addressesOf(id)).find((a) => a.kind === "temp_alias")!;
  return { linkId: id, aliasId: alias.id };
}

async function expectLinkCount(n: number) {
  const linkCount = await env.DB.prepare("select count(*) as n from links").first<{ n: number }>();
  expect(linkCount?.n).toBe(n);
}

beforeEach(applyTestMigrations);
afterEach(reset);

describe("POST /orgs/:orgId/links: creates a synced primary address", () => {
  it("gives a new link exactly one primary link_addresses row matching its own slug/domain", async () => {
    const cookie = await seed();
    const created = await api(cookie, "POST", "/links", {
      destination: "https://example.com/a",
      domainId: "domain-1",
      slug: "chosen",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const addresses = await addressesOf(id);
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toMatchObject({
      kind: "primary",
      creationReason: "created",
      slug: "chosen",
      domainId: "domain-1",
      expiresAt: null,
      retiredAt: null,
    });
  });
});

describe("PATCH /orgs/:orgId/links/:linkId: renaming a custom-domain address", () => {
  it("keeps the old slug alive as a 48h temp_alias and moves the primary row to the new slug", async () => {
    const cookie = await seed();
    const created = await api(cookie, "POST", "/links", {
      destination: "https://example.com/a",
      domainId: "domain-1",
      slug: "old-slug",
    });
    const { id } = (await created.json()) as { id: string };
    const beforeRename = Date.now();

    const renamed = await api(cookie, "PATCH", `/links/${id}`, { slug: "new-slug" });
    expect(renamed.status).toBe(200);

    const addresses = await addressesOf(id);
    expect(addresses).toHaveLength(2);

    const primary = addresses.find((a) => a.kind === "primary")!;
    expect(primary.slug).toBe("new-slug");
    expect(primary.expiresAt).toBeNull();

    const alias = addresses.find((a) => a.kind === "temp_alias")!;
    expect(alias.slug).toBe("old-slug");
    expect(alias.creationReason).toBe("renamed");
    expect(alias.retiredAt).toBeNull();
    expect(alias.expiresAt).toBeGreaterThanOrEqual(beforeRename + ALIAS_TTL_MS);
    expect(alias.expiresAt).toBeLessThan(beforeRename + ALIAS_TTL_MS + 5000);
  });

  it("rejects a domain change: a link's aliases are bound to its domain, so it can't move", async () => {
    const cookie = await seed();
    const created = await api(cookie, "POST", "/links", { destination: "https://example.com/a" });
    const { id } = (await created.json()) as { id: string };

    const moved = await api(cookie, "PATCH", `/links/${id}`, { domainId: "domain-1" });
    expect(moved.status).toBe(400);

    const addresses = await addressesOf(id);
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toMatchObject({ kind: "primary", domainId: null });
  });

  it("resyncs every alias's KV key on any edit, not just the primary's", async () => {
    const cookie = await seed();
    const { id } = await createLink(cookie, { destination: "https://example.com/a" });
    await api(cookie, "POST", `/links/${id}/addresses`, {});
    const { slug: aliasSlug } = (await addressesOf(id)).find((a) => a.kind === "permanent_alias")!;

    const { queue, sent } = captureQueue();
    const res = await apiWithEnv(
      overrideEnv({ BETTER_AUTH_SECRET: "test-secret", STORAGE_QUEUE: queue }),
      cookie,
      "PATCH",
      `/links/${id}`,
      { destination: "https://example.com/b" },
    );
    expect(res.status).toBe(200);

    const syncedKeys = sent.filter((m) => m.op === "kv_sync").map((m) => m.key);
    expect(syncedKeys).toContain(`slug:${aliasSlug}`);
  });
});

describe("addresses sub-resource", () => {
  it("POST always creates the address on the link's own domain, ignoring any domainId in the body (#38)", async () => {
    const cookie = await seed();
    const { id: linkId } = await createLink(cookie, { destination: "https://example.com/a" });

    const res = await api(cookie, "POST", `/links/${linkId}/addresses`, {
      domainId: "domain-1",
    });
    expect(res.status).toBe(201);

    const addresses = await addressesOf(linkId);
    const alias = addresses.find((a) => a.kind === "permanent_alias")!;
    expect(alias.domainId).toBeNull();
  });

  it("GET lists every address with its kind and expiry", async () => {
    const { cookie, linkId } = await renamedLink();

    const res = await api(cookie, "GET", `/links/${linkId}/addresses`);
    expect(res.status).toBe(200);
    const dtos = (await res.json()) as { kind: string; slug: string }[];
    expect(dtos.map((d) => d.kind).sort()).toEqual(["primary", "temp_alias"]);
  });

  it("keep-forever flips the alias to permanent and clears its expiry", async () => {
    const { cookie, linkId, aliasId } = await renamedLink();

    const res = await api(cookie, "POST", `/links/${linkId}/addresses/${aliasId}/keep-forever`);
    expect(res.status).toBe(200);

    const row = await addressById(aliasId);
    expect(row).toMatchObject({ kind: "permanent_alias", expiresAt: null, retiredAt: null });

    // Still one link: keeping forever never creates a second links row.
    await expectLinkCount(1);
  });

  it("keep-forever 409s once the alias has already been retired (e.g. by the sweep)", async () => {
    const { cookie, linkId, aliasId } = await renamedLink();
    await db()
      .update(schema.linkAddresses)
      .set({ retiredAt: Date.now() })
      .where(eq(schema.linkAddresses.id, aliasId));

    const res = await api(cookie, "POST", `/links/${linkId}/addresses/${aliasId}/keep-forever`);
    expect(res.status).toBe(409);
  });

  it("remove requires confirmation, then retires the address", async () => {
    const { cookie, linkId, aliasId } = await renamedLink();

    const unconfirmed = await api(
      cookie,
      "POST",
      `/links/${linkId}/addresses/${aliasId}/remove`,
      {},
    );
    expect(unconfirmed.status).toBe(400);

    const confirmed = await api(cookie, "POST", `/links/${linkId}/addresses/${aliasId}/remove`, {
      confirm: true,
    });
    expect(confirmed.status).toBe(200);

    const row = await addressById(aliasId);
    expect(row.retiredAt).not.toBeNull();
  });

  it("refuses to remove the primary address directly", async () => {
    const { cookie, linkId } = await renamedLink();
    const [primary] = (await addressesOf(linkId)).filter((a) => a.kind === "primary");

    const res = await api(cookie, "POST", `/links/${linkId}/addresses/${primary.id}/remove`, {
      confirm: true,
    });
    expect(res.status).toBe(400);
  });

  it("promote swaps the alias and primary slug/domain in place, on the same link", async () => {
    const { cookie, linkId, aliasId } = await renamedLink();

    const res = await api(cookie, "POST", `/links/${linkId}/addresses/${aliasId}/promote`);
    expect(res.status).toBe(200);
    const link = (await res.json()) as { slug: string };
    expect(link.slug).toBe("old-slug"); // the promoted alias's slug

    const addresses = await addressesOf(linkId);
    expect(addresses).toHaveLength(2);
    const newPrimary = addresses.find((a) => a.kind === "primary")!;
    const newAlias = addresses.find((a) => a.kind === "permanent_alias")!;
    expect(newPrimary.slug).toBe("old-slug");
    expect(newAlias.slug).toBe("new-slug");
    expect(newAlias.creationReason).toBe("promoted");
    expect(newAlias.expiresAt).toBeNull(); // never a 48h temp: this was explicit
  });
});

describe("same-destination grouping", () => {
  it("409s with a match instead of silently creating a second link", async () => {
    const cookie = await seed();
    await api(cookie, "POST", "/links", { destination: "https://example.com/pricing" });

    const res = await api(cookie, "POST", "/links", { destination: "https://example.com/pricing" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; matchedLinks: { id: string }[] };
    expect(body.code).toBe("same_destination_match");
    expect(body.matchedLinks).toHaveLength(1);

    await expectLinkCount(1);
  });

  it("mergeIntoLinkId adds a permanent alias to the existing link instead of a new one", async () => {
    const cookie = await seed();
    const { id: matchedLinkId } = await createLink(cookie, {
      destination: "https://example.com/pricing",
      domainId: "domain-1",
      slug: "first-address",
    });

    const res = await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      domainId: "domain-1",
      slug: "second-address",
      mergeIntoLinkId: matchedLinkId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(matchedLinkId);

    await expectLinkCount(1);
    const addresses = await addressesOf(matchedLinkId);
    expect(addresses).toHaveLength(2);
    expect(addresses.find((a) => a.slug === "second-address")).toMatchObject({
      kind: "permanent_alias",
      creationReason: "same_destination_merge",
    });
  });

  it("only matches an existing link on the same domain, never suggesting a cross-domain merge (#38)", async () => {
    const cookie = await seed();
    await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      domainId: "domain-1",
      slug: "on-custom-domain",
    });

    // Same destination, but on the shared domain: no match, so this creates
    // a genuinely separate link instead of offering to merge.
    const res = await api(cookie, "POST", "/links", { destination: "https://example.com/pricing" });
    expect(res.status).toBe(201);

    await expectLinkCount(2);
  });

  it("rejects mergeIntoLinkId onto a link on a different domain", async () => {
    const cookie = await seed();
    const { id: targetId } = await createLink(cookie, {
      destination: "https://example.com/pricing",
      domainId: "domain-1",
      slug: "on-custom-domain",
    });

    const res = await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      mergeIntoLinkId: targetId,
    });
    expect(res.status).toBe(400);
  });

  it("rejects mergeIntoLinkId once the target's destination no longer matches", async () => {
    const cookie = await seed();
    const { id: targetId } = await createLink(cookie, {
      destination: "https://example.com/pricing",
    });

    // Someone else edits the target's destination between the client seeing
    // the same_destination_match response and posting mergeIntoLinkId back.
    await api(cookie, "PATCH", `/links/${targetId}`, {
      destination: "https://example.com/somewhere-else",
    });

    const res = await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      mergeIntoLinkId: targetId,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("merge_target_changed");

    await expectLinkCount(1);
  });

  it("forceSeparateLink creates a genuinely new link despite the match", async () => {
    const cookie = await seed();
    await api(cookie, "POST", "/links", { destination: "https://example.com/pricing" });

    const res = await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      forceSeparateLink: true,
    });
    expect(res.status).toBe(201);

    await expectLinkCount(2);
  });

  it("never matches when UTM values differ, even with the same destination", async () => {
    const cookie = await seed();
    await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      utmCampaign: "spring",
    });

    const res = await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      utmCampaign: "summer",
    });
    expect(res.status).toBe(201);
  });
});

describe("DELETE /orgs/:orgId/links/:linkId", () => {
  it("cascades every address row (primary and alias)", async () => {
    const { cookie, linkId } = await renamedLink();
    expect(await addressesOf(linkId)).toHaveLength(2);

    const res = await api(cookie, "DELETE", `/links/${linkId}`);
    expect(res.status).toBe(200);
    expect(await addressesOf(linkId)).toHaveLength(0);
  });
});

describe("plan limits (#38)", () => {
  // Free plan allows 30 links; fill it with permanent addresses directly so
  // the org sits at its cap without creating 30 real links. A caller that
  // creates a link first before calling this ends up one over the cap,
  // which is the point: it's testing that the next write is still rejected.
  async function fillOrgToLimit() {
    const rows = Array.from({ length: 30 }, (_, i) =>
      rawLinkRow({
        id: `filler-link-${i}`,
        orgId: "org-1",
        slug: `filler-${i}`,
        destination: `https://example.com/filler-${i}`,
        createdAt: 0,
      }),
    );
    const addressRows = rows.map((r) =>
      rawAddressRow({
        id: `filler-addr-${r.id}`,
        linkId: r.id,
        orgId: "org-1",
        slug: r.slug,
        kind: "primary",
        createdAt: 0,
      }),
    );
    // D1 caps bound parameters per statement, so chunk the inserts: ~20
    // columns per links row and ~10 per address row.
    function chunk<T>(items: T[], size: number): T[][] {
      const out: T[][] = [];
      for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
      return out;
    }
    await db().batch([
      ...chunk(rows, 4).map((c) => db().insert(schema.links).values(c)),
      ...chunk(addressRows, 8).map((c) => db().insert(schema.linkAddresses).values(c)),
    ] as never);
  }

  it("402s a new link at the limit", async () => {
    const cookie = await seed();
    await fillOrgToLimit();

    const res = await api(cookie, "POST", "/links", {
      destination: "https://example.com/one-more",
    });
    expect(res.status).toBe(402);
  });

  it("still allows a rename at the limit: the automatic temp_alias never counts against quota", async () => {
    const cookie = await seed();
    const { id } = await createLink(cookie, {
      destination: "https://example.com/a",
      domainId: "domain-1",
      slug: "old-slug",
    });
    await fillOrgToLimit();

    const res = await api(cookie, "PATCH", `/links/${id}`, { slug: "new-slug" });
    expect(res.status).toBe(200);
    const addresses = await addressesOf(id);
    expect(addresses.some((a) => a.kind === "temp_alias")).toBe(true);
  });

  // Both actions leave the org holding one more counted address than it did:
  // keep-forever makes the temp alias permanent, promote makes the old primary
  // permanent. At the cap, neither has room.
  it.each(["keep-forever", "promote"])("402s %s on a temp alias at the limit", async (action) => {
    const { cookie, linkId, aliasId } = await renamedLink();
    await fillOrgToLimit();

    const res = await api(cookie, "POST", `/links/${linkId}/addresses/${aliasId}/${action}`);
    expect(res.status).toBe(402);
  });
});
