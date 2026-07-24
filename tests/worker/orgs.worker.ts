import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { deleteOrg } from "../../src/worker/routes/orgs";
import { adminCookie, applyTestMigrations, authEnv, overrideEnv } from "./support";

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

// A workflow stub whose create() always fails, and whose get() reports a
// given status (or "not found", matching a truly missing instance).
function failingCreateWorkflow(existingStatus?: string): Env["ORG_DELETE"] {
  return {
    async create() {
      throw new Error("injected workflow start failure");
    },
    async get() {
      if (!existingStatus) throw new Error("instance not found");
      return { status: async () => ({ status: existingStatus }) };
    },
  } as unknown as Env["ORG_DELETE"];
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

beforeEach(applyTestMigrations);

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

  it("clears deleting_at when starting the workflow fails and no instance exists, so the delete can be retried", async () => {
    const db = await seedOrg();

    await expect(
      deleteOrg(db, overrideEnv({ ORG_DELETE: failingCreateWorkflow() }), "org-1"),
    ).rejects.toThrow("injected workflow start failure");
    expect(await deletingAtOf("org-1")).toBeNull();

    // A retry with a working workflow succeeds, proving the org was not left
    // stuck deleting.
    const { workflow, creates } = fakeOrgDeleteWorkflow();
    await deleteOrg(db, overrideEnv({ ORG_DELETE: workflow }), "org-1");
    expect(creates).toEqual(["org-1"]);
  });

  it("leaves deleting_at set when create() fails but an instance is already running", async () => {
    const db = await seedOrg();

    // create() can fail on the client side (a timeout, say) while the
    // instance still started server-side: get() finding it "running" is the
    // signal that teardown is genuinely underway, so the write guard must
    // not lift.
    await expect(
      deleteOrg(db, overrideEnv({ ORG_DELETE: failingCreateWorkflow("running") }), "org-1"),
    ).rejects.toThrow("injected workflow start failure");
    expect(await deletingAtOf("org-1")).not.toBeNull();
  });

  it("clears deleting_at when create() fails and the found instance is already terminal", async () => {
    const db = await seedOrg();

    await expect(
      deleteOrg(db, overrideEnv({ ORG_DELETE: failingCreateWorkflow("errored") }), "org-1"),
    ).rejects.toThrow("injected workflow start failure");
    expect(await deletingAtOf("org-1")).toBeNull();
  });
});

describe("requireOrgRole: writes during teardown", () => {
  async function call(request: Request, callEnv: Env = authEnv()): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, callEnv, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  function postLink(cookie: string): Promise<Response> {
    return call(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://example.com" }),
      }),
    );
  }

  it("rejects a write once the org is marked deleting, but still allows reads", async () => {
    await seedOrg();
    await env.DB.prepare("update orgs set deleting_at = ? where id = 'org-1'").bind(1).run();
    const cookie = await adminCookie();

    expect((await postLink(cookie)).status).toBe(409);

    const list = await call(
      new Request("http://localhost/api/orgs/org-1/links", { headers: { cookie } }),
    );
    expect(list.status).toBe(200);
  });

  it("allows a write when the org is not deleting", async () => {
    await seedOrg();
    const cookie = await adminCookie();

    expect((await postLink(cookie)).status).toBe(201);
  });

  it("a duplicate DELETE is a no-op, not a 409, once the first has marked the org deleting", async () => {
    await seedOrg();
    const cookie = await adminCookie();
    // Stub the workflow so this only exercises deleteOrg's own idempotency
    // and the route's write-block exemption, not real Workflow execution
    // (which runs detached from the request and would outlive the test).
    const { workflow } = fakeOrgDeleteWorkflow();
    const del = () =>
      call(
        new Request("http://localhost/api/orgs/org-1", { method: "DELETE", headers: { cookie } }),
        overrideEnv({ BETTER_AUTH_SECRET: "test-secret", ORG_DELETE: workflow }),
      );

    const first = await del();
    expect(first.status).toBe(200);

    const second = await del();
    expect(second.status).toBe(200);
  });
});
