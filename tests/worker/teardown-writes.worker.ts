/**
 * Writes that arrive while an org is being torn down (#52). A create that passed
 * `requireOrgRole` just before `deleteOrg` set the flag still commits after the teardown
 * snapshot. These call the insert helpers directly: the route would measure the guard.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import { and, eq } from "drizzle-orm";
import {
  guardedTempAliasStatement,
  insertAddressWithinLimit,
  insertDomainWithinLimit,
  insertLinkWithinLimit,
  notDeletingSql,
  toD1Statement,
} from "../../src/worker/plan";
import { putQrLogoIfOrgWritable } from "../../src/worker/routes/qr-logos";
import { applyTestMigrations, testEnv } from "./support";

const ORG = "org-teardown";
const LIMIT = 100;

afterEach(reset);

beforeEach(async () => {
  await applyTestMigrations();
  await env.DB.prepare("insert into orgs (id, name, created_at) values (?, 'Going Away', 0)")
    .bind(ORG)
    .run();
});

const markDeleting = () =>
  env.DB.prepare("update orgs set deleting_at = ? where id = ?").bind(Date.now(), ORG).run();

const addressCount = async (): Promise<number> =>
  (await env.DB.prepare("select count(*) as n from link_addresses where org_id = ?")
    .bind(ORG)
    .first<{ n: number }>())!.n;

const linkCount = async (): Promise<number> =>
  (await env.DB.prepare("select count(*) as n from links where org_id = ?").bind(ORG).first<{
    n: number;
  }>())!.n;

const domainCount = async (): Promise<number> =>
  (await env.DB.prepare("select count(*) as n from domains where org_id = ?")
    .bind(ORG)
    .first<{ n: number }>())!.n;

function linkRow(id: string) {
  return { id, orgId: ORG, slug: id, destination: "https://example.com", createdAt: Date.now() };
}

function addressRow(id: string, linkId: string, kind: "primary" | "temp_alias") {
  return { id, linkId, orgId: ORG, slug: id, kind, createdAt: Date.now() };
}

describe("creating a link while the org is tearing down", () => {
  it("writes nothing, and leaves no orphan link behind", async () => {
    await markDeleting();

    const wrote = await insertLinkWithinLimit(
      drizzle(env.DB, { schema }),
      testEnv,
      linkRow("l1"),
      addressRow("a1", "l1", "primary"),
      LIMIT,
    );

    expect(wrote).toBe(false);
    expect(await addressCount()).toBe(0);
    // The batch's third statement removes a link whose address never landed.
    expect(await linkCount()).toBe(0);
  });

  it("still writes when the org is not tearing down", async () => {
    const wrote = await insertLinkWithinLimit(
      drizzle(env.DB, { schema }),
      testEnv,
      linkRow("l2"),
      addressRow("a2", "l2", "primary"),
      LIMIT,
    );

    expect(wrote).toBe(true);
    expect(await addressCount()).toBe(1);
  });
});

describe("adding an address to an existing link while the org is tearing down", () => {
  beforeEach(async () => {
    await insertLinkWithinLimit(
      drizzle(env.DB, { schema }),
      testEnv,
      linkRow("l3"),
      addressRow("a3", "l3", "primary"),
      LIMIT,
    );
  });

  it("refuses a permanent alias", async () => {
    await markDeleting();
    const wrote = await insertAddressWithinLimit(
      testEnv,
      addressRow("a4", "l3", "primary"),
      LIMIT,
      10,
    );
    expect(wrote).toBe(false);
    expect(await addressCount()).toBe(1);
  });

  it("refuses a temp alias too", async () => {
    // A temp_alias never counts toward the plan cap, so it has no other WHERE
    // clause that could refuse it, and it publishes a redirect all the same.
    await markDeleting();
    const wrote = await insertAddressWithinLimit(
      testEnv,
      addressRow("a5", "l3", "temp_alias"),
      LIMIT,
      10,
    );
    expect(wrote).toBe(false);
    expect(await addressCount()).toBe(1);
  });

  it("still writes a temp alias when the org is not tearing down", async () => {
    const wrote = await insertAddressWithinLimit(
      testEnv,
      addressRow("a6", "l3", "temp_alias"),
      LIMIT,
      10,
    );
    expect(wrote).toBe(true);
    expect(await addressCount()).toBe(2);
  });
});

describe("creating a domain while the org is tearing down", () => {
  const domainRow = (id: string) => ({
    id,
    orgId: ORG,
    hostname: `${id}.example.com`,
    createdAt: Date.now(),
  });

  it("refuses the row after teardown has started", async () => {
    await markDeleting();

    expect(await insertDomainWithinLimit(testEnv, domainRow("gone"), LIMIT)).toBe(false);
    expect(await domainCount()).toBe(0);
  });

  it("still writes before teardown starts", async () => {
    expect(await insertDomainWithinLimit(testEnv, domainRow("kept"), LIMIT)).toBe(true);
    expect(await domainCount()).toBe(1);
  });
});

describe("uploading a QR logo while the org is tearing down", () => {
  it("removes the object written after teardown started", async () => {
    await markDeleting();
    const key = `${ORG}/late.webp`;

    expect(
      await putQrLogoIfOrgWritable(
        drizzle(env.DB, { schema }),
        env.MEDIA,
        ORG,
        key,
        new Uint8Array([1, 2, 3]).buffer,
        "image/webp",
      ),
    ).toBe(false);
    expect(await env.MEDIA.head(key)).toBeNull();
  });
});

// The rename exactly as the PATCH route builds it; every statement carries the teardown guard.
function renameBatch(aliasId: string) {
  const db = drizzle(env.DB, { schema });
  return env.DB.batch([
    toD1Statement(
      testEnv,
      db
        .update(schema.links)
        .set({ slug: "renamed" })
        .where(and(eq(schema.links.id, "l9"), notDeletingSql(ORG)))
        .toSQL(),
    ),
    toD1Statement(
      testEnv,
      db
        .update(schema.linkAddresses)
        .set({ slug: "renamed" })
        .where(
          and(
            eq(schema.linkAddresses.linkId, "l9"),
            eq(schema.linkAddresses.kind, "primary"),
            notDeletingSql(ORG),
          ),
        )
        .toSQL(),
    ),
    guardedTempAliasStatement(testEnv, { ...addressRow(aliasId, "l9", "temp_alias"), slug: "a9" }),
  ]);
}

describe("renaming a link while the org is tearing down", () => {
  // The rename batches its own inserts, so it never goes through the guarded ones above.
  beforeEach(async () => {
    await insertLinkWithinLimit(
      drizzle(env.DB, { schema }),
      testEnv,
      linkRow("l9"),
      addressRow("a9", "l9", "primary"),
      LIMIT,
    );
  });

  it("moves no slug and mints no alias", async () => {
    await markDeleting();

    const results = await renameBatch("a10");

    expect(results.map((r) => r.meta.changes)).toEqual([0, 0, 0]);
    expect(await addressCount()).toBe(1);
  });

  it("still renames when the org is not tearing down", async () => {
    const results = await renameBatch("a11");

    expect(results.map((r) => r.meta.changes)).toEqual([1, 1, 1]);
    expect(await addressCount()).toBe(2);
  });
});
