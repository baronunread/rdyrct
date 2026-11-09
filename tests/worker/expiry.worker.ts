import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import { applyStorageMessage, sweepExpiredAliases, syncLinkMsg } from "../../src/worker/storage";
import { sweepExpiredInvites } from "../../src/worker/routes/orgs";
import {
  addressById,
  applyTestMigrations,
  rawAddressRow,
  rawLinkRow,
  testDb as db,
  testEnv,
} from "./support";

async function seedLinkWithAddresses() {
  await db().batch([
    db().insert(schema.orgs).values({ id: "org-1", name: "Test", createdAt: 0 }),
    db()
      .insert(schema.links)
      .values(
        rawLinkRow({
          id: "link-1",
          orgId: "org-1",
          slug: "new-slug",
          destination: "https://example.com",
          createdAt: 0,
        }),
      ),
    db()
      .insert(schema.linkAddresses)
      .values([
        rawAddressRow({
          id: "addr-primary",
          linkId: "link-1",
          orgId: "org-1",
          slug: "new-slug",
          kind: "primary",
          creationReason: "created",
          createdAt: 0,
        }),
        rawAddressRow({
          id: "addr-alias",
          linkId: "link-1",
          orgId: "org-1",
          slug: "old-slug",
          kind: "temp_alias",
          creationReason: "renamed",
          expiresAt: Date.now() - 1000, // already past its 48h deadline
          createdAt: 0,
        }),
      ]),
  ]);
}

beforeEach(applyTestMigrations);
afterEach(reset);

describe("desiredKvValue resolves through link_addresses", () => {
  it("publishes a temp_alias key with its expiresAt baked in", async () => {
    await seedLinkWithAddresses();
    await applyStorageMessage(testEnv, db(), syncLinkMsg("old-slug", null));

    const value = await env.LINKS.get<{ linkId: string; addressId: string; expiresAt: number }>(
      "slug:old-slug",
      "json",
    );
    expect(value).toMatchObject({ linkId: "link-1", addressId: "addr-alias" });
    expect(value!.expiresAt).toBeLessThan(Date.now());
  });

  it("deletes the key once the row is retired, even though it was still active when first published", async () => {
    await seedLinkWithAddresses();
    const message = syncLinkMsg("old-slug", null);
    await applyStorageMessage(testEnv, db(), message);
    expect(await env.LINKS.get("slug:old-slug")).not.toBeNull();

    await db()
      .update(schema.linkAddresses)
      .set({ retiredAt: Date.now() })
      .where(eq(schema.linkAddresses.id, "addr-alias"));
    await applyStorageMessage(testEnv, db(), message);

    expect(await env.LINKS.get("slug:old-slug")).toBeNull();
  });
});

describe("redirect hot path: lazy expiry", () => {
  async function fetchWorker(request: Request) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }

  it("stops resolving an expired alias immediately, with the stale KV value still in place", async () => {
    await env.LINKS.put(
      "slug:old-slug",
      JSON.stringify({
        linkId: "link-1",
        addressId: "addr-alias",
        orgId: "org-1",
        url: "https://example.com",
        expiresAt: Date.now() - 1000,
      }),
    );

    const res = await fetchWorker(new Request("http://localhost/old-slug", { redirect: "manual" }));
    // Serves the SPA under a 404, same as an unknown slug: an address past its
    // deadline is not a page, and it is certainly not still a redirect.
    expect(res.status).toBe(404);
  });

  it("still resolves a live (not-yet-expired) alias", async () => {
    await env.LINKS.put(
      "slug:old-slug",
      JSON.stringify({
        linkId: "link-1",
        addressId: "addr-alias",
        orgId: "org-1",
        url: "https://example.com",
        expiresAt: Date.now() + 1000,
      }),
    );

    const res = await fetchWorker(new Request("http://localhost/old-slug", { redirect: "manual" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com");
  });
});

describe("sweepExpiredAliases", () => {
  it("retires an expired temp_alias and clears its KV key, leaving the primary untouched", async () => {
    await seedLinkWithAddresses();
    await applyStorageMessage(testEnv, db(), syncLinkMsg("old-slug", null));
    await applyStorageMessage(testEnv, db(), syncLinkMsg("new-slug", null));
    expect(await env.LINKS.get("slug:old-slug")).not.toBeNull();

    await sweepExpiredAliases(testEnv, db());

    const alias = await addressById("addr-alias");
    expect(alias.retiredAt).not.toBeNull();

    const primary = await addressById("addr-primary");
    expect(primary.retiredAt).toBeNull();

    // The sweep only retires the D1 row; syncing the queue message is what
    // actually clears KV (mirrors how storage.ts's own tests exercise sync).
    await applyStorageMessage(testEnv, db(), syncLinkMsg("old-slug", null));
    expect(await env.LINKS.get("slug:old-slug")).toBeNull();
    expect(await env.LINKS.get("slug:new-slug")).not.toBeNull();
  });

  it("does not touch a temp_alias that has not expired yet", async () => {
    await seedLinkWithAddresses();
    await db()
      .update(schema.linkAddresses)
      .set({ expiresAt: Date.now() + 1000 * 60 * 60 })
      .where(eq(schema.linkAddresses.id, "addr-alias"));

    await sweepExpiredAliases(testEnv, db());

    const alias = await addressById("addr-alias");
    expect(alias.retiredAt).toBeNull();
  });

  it("is a no-op re-run against an already-retired row", async () => {
    await seedLinkWithAddresses();
    await sweepExpiredAliases(testEnv, db());
    const first = (await addressById("addr-alias")).retiredAt;

    await sweepExpiredAliases(testEnv, db());
    const second = (await addressById("addr-alias")).retiredAt;
    expect(second).toBe(first);
  });
});

describe("sweepExpiredInvites", () => {
  const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  async function seedInvites() {
    await db().batch([
      db().insert(schema.orgs).values({ id: "org-1", name: "Test", createdAt: 0 }),
      db()
        .insert(schema.invites)
        .values({
          token: "stale-token",
          orgId: "org-1",
          role: "member",
          email: "invited@example.com",
          createdAt: 0,
          expiresAt: Date.now() - 1000,
        }),
      db()
        .insert(schema.invites)
        .values({
          token: "live-token",
          orgId: "org-1",
          role: "member",
          email: null,
          createdAt: 0,
          expiresAt: Date.now() + INVITE_TTL_MS,
        }),
    ]);
  }

  async function tokens(): Promise<string[]> {
    const rows = await db().select({ token: schema.invites.token }).from(schema.invites);
    return rows.map((r) => r.token).sort();
  }

  it("deletes an expired invite and leaves an open one alone", async () => {
    await seedInvites();

    expect(await sweepExpiredInvites(testEnv)).toBe(1);
    expect(await tokens()).toEqual(["live-token"]);
  });

  it("is a no-op re-run once the expired ones are gone", async () => {
    await seedInvites();
    await sweepExpiredInvites(testEnv);

    expect(await sweepExpiredInvites(testEnv)).toBe(0);
    expect(await tokens()).toEqual(["live-token"]);
  });
});
