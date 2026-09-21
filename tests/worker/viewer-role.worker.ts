import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { hashPassword } from "../../src/worker/password";
import {
  applyTestMigrations,
  fetchWorker,
  freeOwnerCookie,
  signInCookie,
  TEST_PASSWORD,
} from "./support";

/**
 * A viewer reads everything the org holds and writes nothing (#157).
 *
 * The split is the whole feature, so it is asserted route by route rather
 * than by spot-check: getting it wrong one way locks a viewer out of the only
 * thing they exist to do, and the other way hands them a write.
 */
async function seedViewer(role = "viewer"): Promise<string> {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('viewer-1', 'Viewer', 'viewer@example.com', 1, 0, 'free', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-viewer-1', 'viewer-1', 'credential', 'viewer-1', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'viewer-1', ?, 0)",
    ).bind(role),
  ]);
  return signInCookie("viewer@example.com", TEST_PASSWORD);
}

async function seedLink() {
  await env.DB.batch([
    env.DB.prepare(
      "insert into links (id, org_id, slug, destination, created_at) values ('link-1', 'org-1', 'sale', 'https://example.com', 0)",
    ),
  ]);
  await env.DB.prepare(
    "insert into link_addresses (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at) values ('addr-1', 'link-1', 'org-1', null, 'sale', 'primary', 'created', null, null, 0)",
  ).run();
}

const url = (path: string) => `http://localhost/api/orgs/org-1${path}`;

/** Every read a member can reach. A viewer must reach all of them. */
const READS = [
  "/links",
  "/links/quota-usage",
  "/links/link-1/addresses",
  "/members",
  "/stats",
  "/clicks",
  "/links/stats/sale",
];

/** Every write. A viewer must reach none of them. */
const WRITES: [string, string, unknown][] = [
  ["POST", "/links", { destination: "https://example.com/new" }],
  ["POST", "/links/claim", { slug: "whatever" }],
  ["PATCH", "/links/link-1", { title: "Renamed" }],
  ["DELETE", "/links/link-1", null],
  ["POST", "/links/link-1/addresses", {}],
  ["PATCH", "/links/link-1/addresses/addr-1", { kind: "permanent" }],
  ["DELETE", "/links/link-1/addresses/addr-1", null],
  ["POST", "/qr-logo", null],
];

beforeEach(applyTestMigrations);
afterEach(reset);

describe("the viewer role", () => {
  it("reaches every read a member reaches", async () => {
    await freeOwnerCookie();
    await seedLink();
    const cookie = await seedViewer();

    for (const path of READS) {
      const res = await fetchWorker(new Request(url(path), { headers: { cookie } }));
      expect(res.status, `GET ${path} should be readable by a viewer`).toBe(200);
    }
  });

  it("is refused every write", async () => {
    await freeOwnerCookie();
    await seedLink();
    const cookie = await seedViewer();

    for (const [method, path, body] of WRITES) {
      const res = await fetchWorker(
        new Request(url(path), {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === null ? undefined : JSON.stringify(body),
        }),
      );
      expect(res.status, `${method} ${path} should be refused for a viewer`).toBe(403);
    }
  });

  it("still lets a member through those same writes", async () => {
    await freeOwnerCookie();
    await seedLink();
    const cookie = await seedViewer("member");

    // The one that proves the refusals above are about the role and not about
    // the seeding: the same request, from a member, is not a 403.
    const res = await fetchWorker(
      new Request(url("/links/link-1"), {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed" }),
      }),
    );
    expect(res.status).toBe(200);
  });

  // The copy-link invite rather than the email one: this is about the role
  // surviving into the row, and a mail send would only add a dependency on
  // the email emulator to say so.
  it("can be invited, and the invite stores the role", async () => {
    const owner = await freeOwnerCookie();
    const res = await fetchWorker(
      new Request(url("/invites"), {
        method: "POST",
        headers: { cookie: owner, "content-type": "application/json" },
        body: JSON.stringify({ role: "viewer", emails: [] }),
      }),
    );
    expect(res.status).toBe(201);

    const row = await env.DB.prepare("select role from invites where org_id = 'org-1'").first<{
      role: string;
    }>();
    expect(row?.role).toBe("viewer");
  });

  it("survives the rebuild: the migration keeps existing memberships", async () => {
    await freeOwnerCookie();
    const row = await env.DB.prepare(
      "select role, created_at from org_members where org_id = 'org-1' and user_id = 'free-1'",
    ).first<{ role: string; created_at: number }>();
    expect(row).toEqual({ role: "owner", created_at: 0 });
  });
});
