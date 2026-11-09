import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import {
  applyTestMigrations,
  authEnv,
  freeOwnerCookie,
  signInCookie,
  TEST_PASSWORD,
} from "./support";
import { hashPassword } from "../../src/worker/password";
import type { JsonValue } from "../../src/shared/types";

/**
 * A slug freed by deleting a link cannot be repointed by somebody else (#76).
 *
 * #76 proposed a cooldown that holds a deleted link's slug, on the reasoning
 * that whoever claims it next inherits the QR codes and printed flyers
 * already pointing there. Two rules that predate the issue already close that
 * door, and these tests pin them, because a cooldown would be dead weight
 * while they hold and the issue becomes real the day either one goes:
 *
 * 1. Nobody chooses a slug on the shared domain. Every shared-domain link
 *    gets a random one, so a freed slug cannot be targeted.
 * 2. A link's domain must belong to the org creating it, so a custom-domain
 *    slug can only ever be claimed back by the org that owns the host.
 *
 * What is left is an org reclaiming its own freed slug, which #76 says should
 * stay allowed, and the last test here confirms it does.
 */

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});
afterEach(reset);

async function apiAs(
  cookie: string,
  orgId: string,
  method: string,
  path: string,
  body?: JsonValue,
) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost/api/orgs/${orgId}${path}`, {
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

/** A second org, with its own owner and its own active custom domain. */
async function seedOutsider(): Promise<string> {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('out-1','Outsider','outsider@example.com',1,0,'free',0,0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-out-1','out-1','credential','out-1',?,0,0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-2', 'Outsider Co', 0)"),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-2','out-1','owner',0)",
    ),
  ]);
  return signInCookie("outsider@example.com", TEST_PASSWORD);
}

describe("a slug freed by deletion cannot be repointed by another org (#76)", () => {
  it("refuses a chosen slug on the shared domain, so a freed one is untargetable", async () => {
    const cookie = await freeOwnerCookie();

    const res = await apiAs(cookie, "org-1", "POST", "/links", {
      destination: "https://example.com/a",
      slug: "sale",
    });

    expect(res.status).toBe(400);
    expect((await res.json<{ message: string }>()).message).toContain("random slugs");
  });

  it("refuses an outsider the domain the freed slug lived on", async () => {
    const owner = await freeOwnerCookie({ id: "domain-1", hostname: "go.example.com" });
    const created = await apiAs(owner, "org-1", "POST", "/links", {
      destination: "https://example.com/a",
      slug: "sale",
      domainId: "domain-1",
    });
    expect(created.status).toBe(201);
    const { id } = await created.json<{ id: string }>();

    // The owner deletes it, so the slug is free as far as link_addresses knows.
    expect((await apiAs(owner, "org-1", "DELETE", `/links/${id}`)).status).toBe(200);

    // The outsider now tries to take it on the same host. They cannot even
    // name that domain: it is not theirs, and the check runs before the slug
    // is looked at.
    const outsider = await seedOutsider();
    const stolen = await apiAs(outsider, "org-2", "POST", "/links", {
      destination: "https://phish.example/",
      slug: "sale",
      domainId: "domain-1",
    });

    expect(stolen.status).toBe(400);
    expect((await stolen.json<{ message: string }>()).message).toContain("Unknown domain");
  });

  it("lets the original org take its own freed slug back", async () => {
    const owner = await freeOwnerCookie({ id: "domain-1", hostname: "go.example.com" });
    const created = await apiAs(owner, "org-1", "POST", "/links", {
      destination: "https://example.com/a",
      slug: "sale",
      domainId: "domain-1",
    });
    const { id } = await created.json<{ id: string }>();
    await apiAs(owner, "org-1", "DELETE", `/links/${id}`);

    const again = await apiAs(owner, "org-1", "POST", "/links", {
      destination: "https://example.com/b",
      slug: "sale",
      domainId: "domain-1",
    });

    expect(again.status).toBe(201);
  });
});
