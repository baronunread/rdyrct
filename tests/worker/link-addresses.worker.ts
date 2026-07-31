import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import { hashPassword } from "../../src/worker/password";
import { now } from "../../src/worker/util";
import { applyTestMigrations, authEnv, signInCookie, TEST_PASSWORD } from "./support";

const ALIAS_TTL_MS = 48 * 60 * 60 * 1000;

/** A free-plan owner of "org-1", with an active custom domain "go.example.com". */
async function seed(): Promise<string> {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('free-1', 'Free', 'free@example.com', 1, 0, 'free', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-free-1', 'free-1', 'credential', 'free-1', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Test', 0)"),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'free-1', 'owner', 0)",
    ),
    env.DB.prepare(
      "insert into domains (id, org_id, hostname, status, created_at) values ('domain-1', 'org-1', 'go.example.com', 'active', 0)",
    ),
  ]);
  return signInCookie("free@example.com", TEST_PASSWORD);
}

async function api(
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
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

function db() {
  return drizzle(env.DB, { schema });
}

async function addressesOf(linkId: string) {
  return db().select().from(schema.linkAddresses).where(eq(schema.linkAddresses.linkId, linkId));
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
    const beforeRename = now();

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

  it("does not create an alias when renaming a shared-domain link (it has no chosen slug to preserve)", async () => {
    const cookie = await seed();
    const created = await api(cookie, "POST", "/links", { destination: "https://example.com/a" });
    const { id } = (await created.json()) as { id: string };

    // Moving a shared-domain link onto a custom domain is a "moved" rename
    // (domainId changed), but the address it's moving away from was never on
    // a custom domain, so no alias should be created for it.
    const moved = await api(cookie, "PATCH", `/links/${id}`, { domainId: "domain-1" });
    expect(moved.status).toBe(200);

    const addresses = await addressesOf(id);
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toMatchObject({ kind: "primary", domainId: "domain-1" });
  });
});

describe("addresses sub-resource", () => {
  async function createRenamedLink(cookie: string) {
    const created = await api(cookie, "POST", "/links", {
      destination: "https://example.com/a",
      domainId: "domain-1",
      slug: "old-slug",
    });
    const { id } = (await created.json()) as { id: string };
    await api(cookie, "PATCH", `/links/${id}`, { slug: "new-slug" });
    const addresses = await addressesOf(id);
    const alias = addresses.find((a) => a.kind === "temp_alias")!;
    return { linkId: id, aliasId: alias.id };
  }

  it("GET lists every address with its kind and expiry", async () => {
    const cookie = await seed();
    const { linkId } = await createRenamedLink(cookie);

    const res = await api(cookie, "GET", `/links/${linkId}/addresses`);
    expect(res.status).toBe(200);
    const dtos = (await res.json()) as { kind: string; slug: string }[];
    expect(dtos.map((d) => d.kind).sort()).toEqual(["primary", "temp_alias"]);
  });

  it("keep-forever flips the alias to permanent and clears its expiry", async () => {
    const cookie = await seed();
    const { linkId, aliasId } = await createRenamedLink(cookie);

    const res = await api(cookie, "POST", `/links/${linkId}/addresses/${aliasId}/keep-forever`);
    expect(res.status).toBe(200);

    const [row] = await db()
      .select()
      .from(schema.linkAddresses)
      .where(eq(schema.linkAddresses.id, aliasId));
    expect(row).toMatchObject({ kind: "permanent_alias", expiresAt: null, retiredAt: null });

    // Still one link: keeping forever never creates a second links row.
    const linkCount = await env.DB.prepare("select count(*) as n from links").first<{
      n: number;
    }>();
    expect(linkCount?.n).toBe(1);
  });

  it("keep-forever 409s once the alias has already been retired (e.g. by the sweep)", async () => {
    const cookie = await seed();
    const { linkId, aliasId } = await createRenamedLink(cookie);
    await db()
      .update(schema.linkAddresses)
      .set({ retiredAt: now() })
      .where(eq(schema.linkAddresses.id, aliasId));

    const res = await api(cookie, "POST", `/links/${linkId}/addresses/${aliasId}/keep-forever`);
    expect(res.status).toBe(409);
  });

  it("remove requires confirmation, then retires the address", async () => {
    const cookie = await seed();
    const { linkId, aliasId } = await createRenamedLink(cookie);

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

    const [row] = await db()
      .select()
      .from(schema.linkAddresses)
      .where(eq(schema.linkAddresses.id, aliasId));
    expect(row.retiredAt).not.toBeNull();
  });

  it("refuses to remove the primary address directly", async () => {
    const cookie = await seed();
    const { linkId } = await createRenamedLink(cookie);
    const [primary] = (await addressesOf(linkId)).filter((a) => a.kind === "primary");

    const res = await api(cookie, "POST", `/links/${linkId}/addresses/${primary.id}/remove`, {
      confirm: true,
    });
    expect(res.status).toBe(400);
  });

  it("promote swaps the alias and primary slug/domain in place, on the same link", async () => {
    const cookie = await seed();
    const { linkId, aliasId } = await createRenamedLink(cookie);

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
    const body = (await res.json()) as { code: string; matchedLinkId: string };
    expect(body.code).toBe("same_destination_match");

    const linkCount = await env.DB.prepare("select count(*) as n from links").first<{
      n: number;
    }>();
    expect(linkCount?.n).toBe(1);
  });

  it("mergeIntoLinkId adds a permanent alias to the existing link instead of a new one", async () => {
    const cookie = await seed();
    const first = await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
    });
    const { id: matchedLinkId } = (await first.json()) as { id: string };

    const res = await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      domainId: "domain-1",
      slug: "second-address",
      mergeIntoLinkId: matchedLinkId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(matchedLinkId);

    const linkCount = await env.DB.prepare("select count(*) as n from links").first<{
      n: number;
    }>();
    expect(linkCount?.n).toBe(1);
    const addresses = await addressesOf(matchedLinkId);
    expect(addresses).toHaveLength(2);
    expect(addresses.find((a) => a.slug === "second-address")).toMatchObject({
      kind: "permanent_alias",
      creationReason: "same_destination_merge",
    });
  });

  it("forceSeparateLink creates a genuinely new link despite the match", async () => {
    const cookie = await seed();
    await api(cookie, "POST", "/links", { destination: "https://example.com/pricing" });

    const res = await api(cookie, "POST", "/links", {
      destination: "https://example.com/pricing",
      forceSeparateLink: true,
    });
    expect(res.status).toBe(201);

    const linkCount = await env.DB.prepare("select count(*) as n from links").first<{
      n: number;
    }>();
    expect(linkCount?.n).toBe(2);
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
    const cookie = await seed();
    const created = await api(cookie, "POST", "/links", {
      destination: "https://example.com/a",
      domainId: "domain-1",
      slug: "old-slug",
    });
    const { id } = (await created.json()) as { id: string };
    await api(cookie, "PATCH", `/links/${id}`, { slug: "new-slug" });
    expect(await addressesOf(id)).toHaveLength(2);

    const res = await api(cookie, "DELETE", `/links/${id}`);
    expect(res.status).toBe(200);
    expect(await addressesOf(id)).toHaveLength(0);
  });
});

describe("plan limits (#38)", () => {
  // Free plan allows 30 links; fill it with permanent addresses directly so
  // the org sits exactly at its cap without creating 30 real links.
  async function fillOrgToLimit() {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `filler-link-${i}`,
      orgId: "org-1",
      slug: `filler-${i}`,
      destination: `https://example.com/filler-${i}`,
      title: "",
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
      qrLogo: "",
      qrStyle: "",
      qrColor: "",
      qrCorner: "",
      qrBg: "",
      qrEyeColor: "",
      qrLogoSize: null,
      createdBy: null,
      createdAt: 0,
    }));
    const addressRows = rows.map((r) => ({
      id: `filler-addr-${r.id}`,
      linkId: r.id,
      orgId: "org-1",
      domainId: null as string | null,
      slug: r.slug,
      kind: "primary" as const,
      creationReason: "" as const,
      expiresAt: null as number | null,
      retiredAt: null as number | null,
      createdAt: 0,
    }));
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
    const created = await api(cookie, "POST", "/links", {
      destination: "https://example.com/a",
      domainId: "domain-1",
      slug: "old-slug",
    });
    const { id } = (await created.json()) as { id: string };
    await fillOrgToLimit();

    const res = await api(cookie, "PATCH", `/links/${id}`, { slug: "new-slug" });
    expect(res.status).toBe(200);
    const addresses = await addressesOf(id);
    expect(addresses.some((a) => a.kind === "temp_alias")).toBe(true);
  });

  it("402s keep-forever at the limit: making a temp alias permanent needs room", async () => {
    const cookie = await seed();
    const created = await api(cookie, "POST", "/links", {
      destination: "https://example.com/a",
      domainId: "domain-1",
      slug: "old-slug",
    });
    const { id } = (await created.json()) as { id: string };
    await api(cookie, "PATCH", `/links/${id}`, { slug: "new-slug" });
    const alias = (await addressesOf(id)).find((a) => a.kind === "temp_alias")!;
    await fillOrgToLimit();

    const res = await api(cookie, "POST", `/links/${id}/addresses/${alias.id}/keep-forever`);
    expect(res.status).toBe(402);
  });
});
