import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { deleteOrg } from "../../src/worker/routes/orgs";
import { hashPassword } from "../../src/worker/password";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };

function overrideEnv(overrides: Partial<Env>): Env {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property in overrides) return overrides[property as keyof Env];
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as Env;
}

// Env with a non-empty auth secret, independent of the ambient .dev.vars, so
// sign-in's rate-limit key derivation has a key to HMAC with.
const authEnv = () => overrideEnv({ BETTER_AUTH_SECRET: "test-secret" });

// A workflow stub that records create() calls without running the real
// OrgDeleteWorkflow, so these tests assert deleteOrg's own gating logic
// instead of depending on Workflows execution semantics.
function fakeOrgDeleteWorkflow(): { workflow: Env["ORG_DELETE"]; creates: string[] } {
  const creates: string[] = [];
  const workflow = {
    async create(options: { id?: string }) {
      creates.push(options.id ?? "");
      return {} as never;
    },
  } as unknown as Env["ORG_DELETE"];
  return { workflow, creates };
}

async function seedOrg(id = "org-1") {
  const db = drizzle(env.DB, { schema });
  await db.insert(schema.orgs).values({ id, name: "Test", createdAt: 0 });
  return db;
}

async function deletingAtOf(id: string): Promise<number | null> {
  const row = await env.DB.prepare("select deleting_at from orgs where id = ?")
    .bind(id)
    .first<{ deleting_at: number | null }>();
  return row?.deleting_at ?? null;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("deleteOrg: marking an org deleting", () => {
  it("sets deleting_at before starting the teardown workflow", async () => {
    const db = await seedOrg();
    const { workflow, creates } = fakeOrgDeleteWorkflow();

    await deleteOrg(db, overrideEnv({ ORG_DELETE: workflow }), "org-1");

    expect(await deletingAtOf("org-1")).not.toBeNull();
    expect(creates).toEqual(["org-1"]);
  });

  it("is a no-op on a second call once the org is already marked deleting", async () => {
    const db = await seedOrg();
    const { workflow, creates } = fakeOrgDeleteWorkflow();
    const testEnv = overrideEnv({ ORG_DELETE: workflow });

    await deleteOrg(db, testEnv, "org-1");
    await deleteOrg(db, testEnv, "org-1");

    // Only the call that actually flipped the flag starts the workflow, so a
    // double-submitted delete never races ORG_DELETE.create against its own
    // keyed instance id.
    expect(creates).toEqual(["org-1"]);
  });

  it("clears deleting_at when starting the workflow fails, so the delete can be retried", async () => {
    const db = await seedOrg();
    const failing = {
      async create() {
        throw new Error("injected workflow start failure");
      },
    } as unknown as Env["ORG_DELETE"];

    await expect(deleteOrg(db, overrideEnv({ ORG_DELETE: failing }), "org-1")).rejects.toThrow(
      "injected workflow start failure",
    );
    expect(await deletingAtOf("org-1")).toBeNull();

    // A retry with a working workflow succeeds, proving the org was not left
    // stuck deleting.
    const { workflow, creates } = fakeOrgDeleteWorkflow();
    await deleteOrg(db, overrideEnv({ ORG_DELETE: workflow }), "org-1");
    expect(creates).toEqual(["org-1"]);
  });
});

describe("requireOrgRole: writes during teardown", () => {
  async function adminCookie(): Promise<string> {
    const password = "correct-horse-battery";
    await env.DB.batch([
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('admin-1', 'Admin', 'admin@example.com', 1, 1, 'pro', 0, 0)",
      ),
      env.DB.prepare(
        "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-1', 'admin-1', 'credential', 'admin-1', ?, 0, 0)",
      ).bind(await hashPassword(password)),
    ]);
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password }),
      }),
      authEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  async function call(request: Request): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, authEnv(), ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("rejects a write once the org is marked deleting, but still allows reads", async () => {
    await seedOrg();
    await env.DB.prepare("update orgs set deleting_at = ? where id = 'org-1'").bind(1).run();
    const cookie = await adminCookie();

    const create = await call(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://example.com" }),
      }),
    );
    expect(create.status).toBe(409);

    const list = await call(
      new Request("http://localhost/api/orgs/org-1/links", { headers: { cookie } }),
    );
    expect(list.status).toBe(200);
  });

  it("allows a write when the org is not deleting", async () => {
    await seedOrg();
    const cookie = await adminCookie();

    const create = await call(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://example.com" }),
      }),
    );
    expect(create.status).toBe(201);
  });
});
