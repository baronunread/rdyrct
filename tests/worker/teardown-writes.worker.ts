/**
 * Writes that arrive while an org is being torn down (#52).
 *
 * `requireOrgRole` refuses them at the route, but it reads the flag before
 * the handler runs. A create that passed that read a moment before
 * `deleteOrg` set the flag still commits afterwards, and the teardown's
 * gather step has already taken its snapshot, so the row survives as a public
 * redirect for an org that is supposed to be gone.
 *
 * These call the insert helpers directly, because the route guard is exactly
 * what a test going through the route would be measuring instead.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import { insertAddressWithinLimit, insertLinkWithinLimit } from "../../src/worker/plan";
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
    // The batch's third statement removes a link whose address never landed,
    // so a refused create cannot leave a row for the teardown to miss.
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
    // A temp_alias never counts toward the plan cap, so it used to be the one
    // insert with no WHERE clause at all: nothing about it could refuse, and
    // it publishes a redirect like any other address.
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
