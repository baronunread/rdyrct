import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { eq } from "drizzle-orm";
import * as schema from "../../src/worker/db/schema";
import {
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  testDb,
} from "./support";

/** An owner of "org-1" with an active custom domain "go.example.com". */
const seed = () => freeOwnerCookie({ id: "domain-1", hostname: "go.example.com" });

function setDefault(cookie: string, defaultDomainId: string | null) {
  return fetchWorker(
    new Request("http://localhost/api/orgs/org-1", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ defaultDomainId }),
    }),
    authEnv(),
  );
}

async function storedDefault(): Promise<string | null> {
  const [row] = await testDb()
    .select({ id: schema.orgs.defaultDomainId })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, "org-1"));
  return row.id;
}

beforeEach(applyTestMigrations);
afterEach(reset);

describe("PATCH /orgs/:orgId { defaultDomainId } (#69)", () => {
  it("stores a domain the org owns, and clears it again with null", async () => {
    const cookie = await seed();

    expect((await setDefault(cookie, "domain-1")).status).toBe(200);
    expect(await storedDefault()).toBe("domain-1");

    expect((await setDefault(cookie, null)).status).toBe(200);
    expect(await storedDefault()).toBeNull();
  });

  it("404s a domain belonging to another org: a default cannot borrow a hostname", async () => {
    const cookie = await seed();
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('org-2', 'Other', 0)"),
      env.DB.prepare(
        "insert into domains (id, org_id, hostname, status, created_at) values ('domain-2', 'org-2', 'other.example.com', 'active', 0)",
      ),
    ]);

    expect((await setDefault(cookie, "domain-2")).status).toBe(404);
    expect(await storedDefault()).toBeNull();
  });

  it("400s a domain that is not serving yet, rather than preselecting a dead address", async () => {
    const cookie = await seed();
    await env.DB.prepare("update domains set status = 'checking_dns' where id = 'domain-1'").run();

    const res = await setDefault(cookie, "domain-1");
    expect(res.status).toBe(400);
    expect(await storedDefault()).toBeNull();
  });

  it("forgets the default when the domain is deleted, and keeps the org", async () => {
    const cookie = await seed();
    await setDefault(cookie, "domain-1");

    const deleted = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/domains/domain-1", {
        method: "DELETE",
        headers: { cookie },
      }),
      authEnv(),
    );
    expect(deleted.status).toBe(200);

    // ON DELETE SET NULL, not a cascade: losing a domain must never take the
    // organization with it (#69).
    expect(await storedDefault()).toBeNull();
    const orgs = await testDb().select().from(schema.orgs).where(eq(schema.orgs.id, "org-1"));
    expect(orgs).toHaveLength(1);
  });

  it("reports the default on /api/user, which is where the editor reads it", async () => {
    const cookie = await seed();
    await setDefault(cookie, "domain-1");

    const res = await fetchWorker(
      new Request("http://localhost/api/user", { headers: { cookie } }),
      authEnv(),
    );
    const body = await jsonBody<{ orgs: { id: string; defaultDomainId: string | null }[] }>(res);
    expect(body.orgs.find((o) => o.id === "org-1")?.defaultDomainId).toBe("domain-1");
  });
});
