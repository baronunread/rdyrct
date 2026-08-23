import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { deleteOrg } from "../../src/worker/routes/orgs";
import { adminCookie, applyTestMigrations, authEnv, overrideEnv } from "./support";

// A workflow instance handle that answers the one question deleteOrg asks of
// it. Every other member throws, so a test that starts depending on Workflows
// execution semantics says so out loud rather than reading a quiet default.
function instanceReporting(status: InstanceStatus["status"]): WorkflowInstance {
  const untested = (): never => {
    throw new Error("this workflow instance member is not part of any deleteOrg test");
  };
  return {
    id: "fake-instance",
    status: async () => ({ status }),
    pause: untested,
    resume: untested,
    terminate: untested,
    restart: untested,
    sendEvent: untested,
    delete: untested,
  };
}

// A workflow stub that records the ids teardown was started for, without
// running the real OrgDeleteWorkflow, so these tests assert deleteOrg's own
// gating logic instead of depending on Workflows execution semantics.
//
// `createBatch` models the documented contract deleteOrg now relies on: an id
// already in use is skipped and left out of the returned array, rather than
// throwing the way `create` does.
function fakeOrgDeleteWorkflow() {
  const started: string[] = [];
  const workflow: Env["ORG_DELETE"] = {
    async create() {
      throw new Error("deleteOrg starts teardown with createBatch, not create");
    },
    async get() {
      throw new Error("instance not found");
    },
    async createBatch(batch) {
      const fresh = batch.filter((entry) => !started.includes(entry.id ?? ""));
      started.push(...fresh.map((entry) => entry.id ?? ""));
      return fresh.map(() => instanceReporting("running"));
    },
    async deleteBatch() {
      throw new Error("deleteOrg never deletes a batch");
    },
  };
  return { workflow, started };
}

// A workflow stub whose start always fails, and whose get() reports a given
// status. With no status it throws, which is what Workflows does both for an
// instance that does not exist and for a lookup that failed: deleteOrg cannot
// tell those apart, so it must not treat either as proof.
function failingStartWorkflow(existingStatus?: InstanceStatus["status"]): Env["ORG_DELETE"] {
  return {
    async create() {
      throw new Error("deleteOrg starts teardown with createBatch, not create");
    },
    async get() {
      if (!existingStatus) throw new Error("instance not found");
      return instanceReporting(existingStatus);
    },
    async createBatch() {
      throw new Error("injected workflow start failure");
    },
    async deleteBatch() {
      throw new Error("deleteOrg never deletes a batch");
    },
  };
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
    const { workflow, started } = fakeOrgDeleteWorkflow();

    await deleteOrg(db, overrideEnv({ ORG_DELETE: workflow }), "org-1");

    expect(await deletingAtOf("org-1")).not.toBeNull();
    expect(started).toEqual(["org-1"]);
  });

  it("starts teardown once however many times it is called", async () => {
    const db = await seedOrg();
    const { workflow, started } = fakeOrgDeleteWorkflow();
    const testEnv = overrideEnv({ ORG_DELETE: workflow });

    await deleteOrg(db, testEnv, "org-1");
    await deleteOrg(db, testEnv, "org-1");

    // Both calls ask, and the second is skipped because the id is in use.
    // That is `createBatch`'s job rather than this function's, which is what
    // lets a repeat DELETE double as a repair without risking a duplicate.
    expect(started).toEqual(["org-1"]);
  });

  it("restarts teardown for an org already flagged with no instance driving it", async () => {
    const db = await seedOrg();
    // The state a failed start can leave behind: flagged, nothing running.
    await env.DB.prepare("update orgs set deleting_at = ? where id = 'org-1'").bind(1).run();
    const { workflow, started } = fakeOrgDeleteWorkflow();

    await deleteOrg(db, overrideEnv({ ORG_DELETE: workflow }), "org-1");

    // Without this the org is stuck: read-only forever, and its DELETE
    // answers 200 while doing nothing.
    expect(started).toEqual(["org-1"]);
  });

  it("leaves deleting_at set when the start fails and the instance cannot be read", async () => {
    const db = await seedOrg();

    // get() throws for a missing instance and for a failed lookup alike, so
    // this is the ambiguous case. Clearing the flag on it would reopen writes
    // under a teardown that may well be running, and those writes outlive the
    // org as public redirects. The next DELETE restarts teardown.
    await expect(
      deleteOrg(db, overrideEnv({ ORG_DELETE: failingStartWorkflow() }), "org-1"),
    ).rejects.toThrow("injected workflow start failure");
    expect(await deletingAtOf("org-1")).not.toBeNull();

    const { workflow, started } = fakeOrgDeleteWorkflow();
    await deleteOrg(db, overrideEnv({ ORG_DELETE: workflow }), "org-1");
    expect(started).toEqual(["org-1"]);
  });

  it("leaves deleting_at set when the start fails but an instance is already running", async () => {
    const db = await seedOrg();

    // The start can fail on the client side (a timeout, say) while the
    // instance still started server-side: get() finding it "running" is the
    // signal that teardown is genuinely underway, so the write guard must
    // not lift.
    await expect(
      deleteOrg(db, overrideEnv({ ORG_DELETE: failingStartWorkflow("running") }), "org-1"),
    ).rejects.toThrow("injected workflow start failure");
    expect(await deletingAtOf("org-1")).not.toBeNull();
  });

  it("clears deleting_at when the start fails and the found instance is already terminal", async () => {
    const db = await seedOrg();

    // The one case that is proof rather than a guess: the instance was read,
    // and it is finished. Nothing is running, so the org goes back to normal
    // and the delete can be retried.
    await expect(
      deleteOrg(db, overrideEnv({ ORG_DELETE: failingStartWorkflow("errored") }), "org-1"),
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
