import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { deleteOrg, sweepStalledOrgDeletions } from "../../src/worker/routes/orgs";
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

/** Runs a delete whose workflow start fails, and reports what the flag was
 * left as. Every "start failed" case differs only in what get() then says. */
async function failedStart(
  db: Awaited<ReturnType<typeof seedOrg>>,
  status?: InstanceStatus["status"],
) {
  await expect(
    deleteOrg(db, overrideEnv({ ORG_DELETE: failingStartWorkflow(status) }), "org-1"),
  ).rejects.toThrow("injected workflow start failure");
  return deletingAtOf("org-1");
}

/** Deletes with a working workflow and reports which ids teardown started
 * for. Every "it starts" case differs only in the state it starts from. */
async function startedIds(db: Awaited<ReturnType<typeof seedOrg>>): Promise<string[]> {
  const { workflow, started } = fakeOrgDeleteWorkflow();
  await deleteOrg(db, overrideEnv({ ORG_DELETE: workflow }), "org-1");
  return started;
}

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
    // Without this the org is stuck: read-only forever, and its DELETE
    // answers 200 while doing nothing.
    await env.DB.prepare("update orgs set deleting_at = ? where id = 'org-1'").bind(1).run();

    expect(await startedIds(db)).toEqual(["org-1"]);
  });

  it("leaves deleting_at set when the start fails and the instance cannot be read", async () => {
    const db = await seedOrg();

    // get() throws for a missing instance and for a failed lookup alike, so
    // this is the ambiguous case. Clearing the flag on it would reopen writes
    // under a teardown that may well be running, and those writes outlive the
    // org as public redirects. The next DELETE restarts teardown.
    expect(await failedStart(db)).not.toBeNull();
    expect(await startedIds(db)).toEqual(["org-1"]);
  });

  it("leaves deleting_at set when the start fails but an instance is already running", async () => {
    // The start can fail on the client side (a timeout, say) while the
    // instance still started server-side: get() finding it "running" is the
    // signal that teardown is genuinely underway, so the write guard must
    // not lift.
    expect(await failedStart(await seedOrg(), "running")).not.toBeNull();
  });

  it("clears deleting_at when the start fails and the found instance is already terminal", async () => {
    // The one case that is proof rather than a guess: the instance was read,
    // and it is finished. Nothing is running, so the org goes back to normal
    // and the delete can be retried.
    expect(await failedStart(await seedOrg(), "errored")).toBeNull();
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

describe("sweepStalledOrgDeletions", () => {
  const HOUR = 60 * 60 * 1000;

  /** A workflow whose instance reports `status` and records restarts. */
  function stalledWorkflow(status?: InstanceStatus["status"], skipCreate = false) {
    const restarts: string[] = [];
    const created: string[] = [];
    const binding: Env["ORG_DELETE"] = {
      async create() {
        throw new Error("the sweep restarts, it does not create");
      },
      async get(id): Promise<WorkflowInstance> {
        if (!status) throw new Error("instance not found");
        // Object.assign, not a spread: WorkflowInstance is a declared class,
        // and TS drops class methods from an object-spread type.
        return Object.assign(instanceReporting(status), {
          id,
          restart: async () => {
            restarts.push(id);
          },
        });
      },
      async createBatch(batch) {
        // Modelling the documented contract: an id already in use is skipped
        // and left out of what comes back. `skipCreate` is what an instance
        // that exists but could not be read looks like from here.
        if (skipCreate) return [];
        created.push(...batch.map((entry) => entry.id ?? ""));
        return batch.map(() => instanceReporting("running"));
      },
      async deleteBatch() {
        throw new Error("the sweep never deletes a batch");
      },
    };
    return { binding, restarts, created };
  }

  async function flagOrg(ageMs: number) {
    const db = await seedOrg();
    await env.DB.prepare("update orgs set deleting_at = ? where id = 'org-1'")
      .bind(Date.now() - ageMs)
      .run();
    return db;
  }

  /** One sweep against a workflow reporting `status`, and everything it did. */
  async function sweep(
    db: Awaited<ReturnType<typeof seedOrg>>,
    status?: InstanceStatus["status"],
    skipCreate = false,
  ) {
    const { binding, restarts, created } = stalledWorkflow(status, skipCreate);
    const count = await sweepStalledOrgDeletions(db, overrideEnv({ ORG_DELETE: binding }));
    return { count, restarts, created };
  }

  it("restarts a teardown whose instance is terminal", async () => {
    const db = await flagOrg(2 * HOUR);
    const { binding, restarts } = stalledWorkflow("errored");

    expect(await sweepStalledOrgDeletions(db, overrideEnv({ ORG_DELETE: binding }))).toBe(1);

    // createBatch skips an id already in use whatever its state, so a repeat
    // DELETE could never have replaced this one: the org was read-only
    // forever and its DELETE answered 200 while nothing ran.
    expect(restarts).toEqual(["org-1"]);
  });

  it("leaves a teardown that is still running alone", async () => {
    expect(await sweep(await flagOrg(2 * HOUR), "running")).toEqual({
      count: 0,
      restarts: [],
      created: [],
    });
  });

  it("moves past a full page of active workflows on the next sweep", async () => {
    const now = 3 * HOUR;
    const activeIds = Array.from({ length: 50 }, (_, i) => `active-${String(i).padStart(2, "0")}`);
    const missingId = "missing-after-active";
    const statements = [...activeIds, missingId].map((id) =>
      env.DB.prepare(
        "insert into orgs (id, name, created_at, deleting_at) values (?, ?, 0, 1)",
      ).bind(id, id),
    );
    for (let i = 0; i < statements.length; i += 25) await env.DB.batch(statements.slice(i, i + 25));

    const created: string[] = [];
    const binding: Env["ORG_DELETE"] = {
      async create() {
        throw new Error("the sweep starts missing instances with createBatch");
      },
      async get(id) {
        if (id === missingId) throw new Error("instance not found");
        return instanceReporting("running");
      },
      async createBatch(batch) {
        created.push(...batch.map((entry) => entry.id ?? ""));
        return batch.map(() => instanceReporting("running"));
      },
      async deleteBatch() {
        throw new Error("the sweep never deletes a batch");
      },
    };
    const db = drizzle(env.DB, { schema });
    const testEnv = overrideEnv({ ORG_DELETE: binding });

    expect(await sweepStalledOrgDeletions(db, testEnv, now)).toBe(0);
    expect(created).toEqual([]);
    expect(await sweepStalledOrgDeletions(db, testEnv, now)).toBe(1);
    expect(created).toEqual([missingId]);
  });

  it("creates one when no instance exists at all", async () => {
    // What a failed ambiguous start leaves behind on the account-deletion
    // path, where the only member is the account that was being deleted and
    // there is nobody left to issue another DELETE.
    const db = await flagOrg(2 * HOUR);
    const { binding, created } = stalledWorkflow();

    expect(await sweepStalledOrgDeletions(db, overrideEnv({ ORG_DELETE: binding }))).toBe(1);

    expect(created).toEqual(["org-1"]);
  });

  it("gives a fresh teardown time to run before touching it", async () => {
    expect(await sweep(await flagOrg(5 * 60 * 1000), "errored")).toEqual({
      count: 0,
      restarts: [],
      created: [],
    });
  });

  it("ignores an org that is not being deleted", async () => {
    const db = await seedOrg();
    const { binding, restarts } = stalledWorkflow("errored");

    expect(await sweepStalledOrgDeletions(db, overrideEnv({ ORG_DELETE: binding }))).toBe(0);
    expect(restarts).toEqual([]);
  });
});

describe("sweepStalledOrgDeletions: reporting", () => {
  const HOUR = 60 * 60 * 1000;

  it("counts nothing when the instance was unreadable but is in fact still in use", async () => {
    const db = await seedOrg();
    await env.DB.prepare("update orgs set deleting_at = ? where id = 'org-1'")
      .bind(Date.now() - 2 * HOUR)
      .run();
    // get() throws for a missing instance and an unreadable one alike, so the
    // create is what settles it: an id already in use is skipped and comes
    // back absent. Reporting a restart on that is a false signal.
    const binding: Env["ORG_DELETE"] = {
      async create() {
        throw new Error("the sweep restarts, it does not create");
      },
      async get() {
        throw new Error("lookup failed");
      },
      async createBatch() {
        return [];
      },
      async deleteBatch() {
        throw new Error("the sweep never deletes a batch");
      },
    };

    expect(await sweepStalledOrgDeletions(db, overrideEnv({ ORG_DELETE: binding }))).toBe(0);
  });
});
