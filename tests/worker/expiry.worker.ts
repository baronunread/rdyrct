import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import { applyStorageMessage, sweepExpiredAliases, syncLinkMsg } from "../../src/worker/storage";
import { now } from "../../src/worker/util";
import { applyTestMigrations, rawAddressRow, rawLinkRow } from "./support";

function db() {
  return drizzle(env.DB, { schema });
}

async function addressById(addressId: string) {
  const [row] = await db()
    .select()
    .from(schema.linkAddresses)
    .where(eq(schema.linkAddresses.id, addressId));
  return row;
}

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
          expiresAt: now() - 1000, // already past its 48h deadline
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
    await applyStorageMessage(env as never, db(), syncLinkMsg("old-slug", null));

    const value = await env.LINKS.get<{ linkId: string; addressId: string; expiresAt: number }>(
      "slug:old-slug",
      "json",
    );
    expect(value).toMatchObject({ linkId: "link-1", addressId: "addr-alias" });
    expect(value!.expiresAt).toBeLessThan(now());
  });

  it("deletes the key once the row is retired, even though it was still active when first published", async () => {
    await seedLinkWithAddresses();
    const message = syncLinkMsg("old-slug", null);
    await applyStorageMessage(env as never, db(), message);
    expect(await env.LINKS.get("slug:old-slug")).not.toBeNull();

    await db()
      .update(schema.linkAddresses)
      .set({ retiredAt: now() })
      .where(eq(schema.linkAddresses.id, "addr-alias"));
    await applyStorageMessage(env as never, db(), message);

    expect(await env.LINKS.get("slug:old-slug")).toBeNull();
  });
});

describe("redirect hot path: lazy expiry", () => {
  async function fetchWorker(request: Request) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env as never, ctx);
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
        expiresAt: now() - 1000,
      }),
    );

    const res = await fetchWorker(new Request("http://localhost/old-slug", { redirect: "manual" }));
    // Falls through to the SPA (not a 302 redirect): same as an unknown slug.
    expect(res.status).not.toBe(302);
  });

  it("still resolves a live (not-yet-expired) alias", async () => {
    await env.LINKS.put(
      "slug:old-slug",
      JSON.stringify({
        linkId: "link-1",
        addressId: "addr-alias",
        orgId: "org-1",
        url: "https://example.com",
        expiresAt: now() + 1000,
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
    await applyStorageMessage(env as never, db(), syncLinkMsg("old-slug", null));
    await applyStorageMessage(env as never, db(), syncLinkMsg("new-slug", null));
    expect(await env.LINKS.get("slug:old-slug")).not.toBeNull();

    await sweepExpiredAliases(env as never, db());

    const alias = await addressById("addr-alias");
    expect(alias.retiredAt).not.toBeNull();

    const primary = await addressById("addr-primary");
    expect(primary.retiredAt).toBeNull();

    // The sweep only retires the D1 row; syncing the queue message is what
    // actually clears KV (mirrors how storage.ts's own tests exercise sync).
    await applyStorageMessage(env as never, db(), syncLinkMsg("old-slug", null));
    expect(await env.LINKS.get("slug:old-slug")).toBeNull();
    expect(await env.LINKS.get("slug:new-slug")).not.toBeNull();
  });

  it("does not touch a temp_alias that has not expired yet", async () => {
    await seedLinkWithAddresses();
    await db()
      .update(schema.linkAddresses)
      .set({ expiresAt: now() + 1000 * 60 * 60 })
      .where(eq(schema.linkAddresses.id, "addr-alias"));

    await sweepExpiredAliases(env as never, db());

    const alias = await addressById("addr-alias");
    expect(alias.retiredAt).toBeNull();
  });

  it("is a no-op re-run against an already-retired row", async () => {
    await seedLinkWithAddresses();
    await sweepExpiredAliases(env as never, db());
    const first = (await addressById("addr-alias")).retiredAt;

    await sweepExpiredAliases(env as never, db());
    const second = (await addressById("addr-alias")).retiredAt;
    expect(second).toBe(first);
  });
});
