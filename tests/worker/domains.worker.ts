import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { ensureHostname, probeDelaySeconds, probeDomain } from "../../src/worker/routes/domains";
import { now } from "../../src/worker/util";
import { adminCookie, applyTestMigrations, authEnv, overrideEnv } from "./support";

// Env with the CF fake off and credentials present, so the real get-or-create
// path runs against a mocked global fetch.
const realCfEnv = () =>
  overrideEnv({ DEV_FAKE_CF: undefined, CF_ZONE_ID: "zone", CF_API_TOKEN: "tok" });

// Env with the CF fake forced on, independent of whatever DEV_FAKE_CF happens
// to be in the ambient .dev.vars (CI runs unit tests before .dev.vars exists).
const fakeCfEnv = () => overrideEnv({ DEV_FAKE_CF: "1" });

const cfJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

async function seedDomain(overrides: Record<string, unknown> = {}) {
  const row = {
    id: "domain-1",
    orgId: "org-1",
    hostname: "go.example.com",
    status: "checking_dns",
    cfHostnameId: null as string | null,
    createdAt: now(),
    ...overrides,
  };
  await env.DB.batch([
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Test', 0)"),
    env.DB.prepare(
      "insert into domains (id, org_id, hostname, status, cf_hostname_id, created_at) values (?, ?, ?, ?, ?, ?)",
    ).bind(row.id, row.orgId, row.hostname, row.status, row.cfHostnameId, row.createdAt),
  ]);
  return row;
}

async function statusOf(id: string) {
  return env.DB.prepare("select status, cf_hostname_id, status_reason from domains where id = ?")
    .bind(id)
    .first<{ status: string; cf_hostname_id: string | null; status_reason: string }>();
}

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

beforeEach(applyTestMigrations);

describe("ensureHostname: get-or-create idempotency", () => {
  it("creates a hostname once and persists its id", async () => {
    await seedDomain();
    let creates = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/custom_hostnames?hostname="))
        return cfJson({ result: [] });
      if (method === "POST" && url.endsWith("/custom_hostnames")) {
        creates++;
        return cfJson({ result: { id: "cf-new" } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const id = await ensureHostname(realCfEnv(), "domain-1", "go.example.com");
    expect(id).toBe("cf-new");
    expect(creates).toBe(1);
    expect((await statusOf("domain-1"))?.cf_hostname_id).toBe("cf-new");
  });

  it("reuses the recorded id on a retry and never calls Cloudflare again", async () => {
    await seedDomain({ cfHostnameId: "cf-existing" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const id = await ensureHostname(realCfEnv(), "domain-1", "go.example.com");
    expect(id).toBe("cf-existing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("after a create succeeds but the persist is lost, a retry reuses the existing hostname (no duplicate)", async () => {
    // The row has no id yet (the persist was lost), but the hostname already
    // lives on the zone from the first attempt. get-or-create must find it, not
    // create a second one.
    await seedDomain();
    let creates = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/custom_hostnames?hostname="))
        return cfJson({ result: [{ id: "cf-first", hostname: "go.example.com" }] });
      if (method === "POST" && url.endsWith("/custom_hostnames")) {
        creates++;
        return cfJson({ result: { id: "cf-second" } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const id = await ensureHostname(realCfEnv(), "domain-1", "go.example.com");
    expect(id).toBe("cf-first");
    expect(creates).toBe(0);
    expect((await statusOf("domain-1"))?.cf_hostname_id).toBe("cf-first");
  });

  it("compensates by deleting the hostname when the domain is removed mid-activation", async () => {
    await seedDomain();
    const deleted: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/custom_hostnames?hostname="))
        return cfJson({ result: [] });
      if (method === "POST" && url.endsWith("/custom_hostnames")) {
        // The user deletes the domain in the window between create and persist.
        await env.DB.prepare("delete from domains where id = 'domain-1'").run();
        return cfJson({ result: { id: "cf-orphan" } });
      }
      if (method === "DELETE" && url.endsWith("/custom_hostnames/cf-orphan")) {
        deleted.push("cf-orphan");
        return cfJson({ result: { id: "cf-orphan" } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const id = await ensureHostname(realCfEnv(), "domain-1", "go.example.com");
    expect(id).toBeNull();
    expect(deleted).toEqual(["cf-orphan"]); // the just-created hostname is undone
  });

  it("returns null without touching Cloudflare when the domain is already gone", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const id = await ensureHostname(realCfEnv(), "missing", "go.example.com");
    expect(id).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("probeDomain: one durable step at a time", () => {
  it("advances checking_dns to issuing_tls, then to active (fake CF)", async () => {
    // createdAt 9s ago: the fake reports DNS + TLS as ready, and it is well
    // under the 24h deadline.
    await seedDomain({ createdAt: now() - 9_000 });

    const first = await probeDomain(fakeCfEnv(), "domain-1");
    expect(first).toEqual({ state: "pending", status: "issuing_tls" });
    expect((await statusOf("domain-1"))?.status).toBe("issuing_tls");

    const second = await probeDomain(fakeCfEnv(), "domain-1");
    expect(second).toEqual({ state: "active" });
    expect((await statusOf("domain-1"))?.status).toBe("active");
  });

  it("leaves checking_dns in place while the fake DNS is still pending", async () => {
    await seedDomain({ createdAt: now() }); // age < 5s: fake DNS not resolved yet
    const probe = await probeDomain(fakeCfEnv(), "domain-1");
    expect(probe).toEqual({ state: "pending", status: "checking_dns" });
    expect((await statusOf("domain-1"))?.status).toBe("checking_dns");
  });

  it("fails a domain that has not resolved within the deadline", async () => {
    await seedDomain({ createdAt: now() - 25 * 60 * 60 * 1000 }); // 25h old
    const probe = await probeDomain(fakeCfEnv(), "domain-1");
    expect(probe.state).toBe("error");
    const after = await statusOf("domain-1");
    expect(after?.status).toBe("error");
    expect(after?.status_reason).toContain("CNAME");
  });

  it("reports active and error as terminal without re-checking", async () => {
    await seedDomain({ status: "active", cfHostnameId: "cf-1", createdAt: now() });
    expect(await probeDomain(fakeCfEnv(), "domain-1")).toEqual({ state: "active" });

    await env.DB.prepare(
      "update domains set status = 'error', status_reason = 'nope' where id = 'domain-1'",
    ).run();
    expect(await probeDomain(fakeCfEnv(), "domain-1")).toEqual({
      state: "error",
      reason: "nope",
    });
  });

  it("reports a missing domain as gone", async () => {
    expect(await probeDomain(fakeCfEnv(), "missing")).toEqual({ state: "gone" });
  });
});

describe("probeDelaySeconds", () => {
  it("polls fast early, then settles at a steady interval", () => {
    expect(probeDelaySeconds(0)).toBe(5);
    expect(probeDelaySeconds(6)).toBe(120);
    expect(probeDelaySeconds(50)).toBe(300);
  });
});

// GET / and POST /:id/refresh must be read-only now that the workflow owns
// activation. Seed a domain old enough that the previous on-read code would have
// advanced it, then assert these routes leave the status untouched and never
// call Cloudflare.
describe("domain reads do not mutate", () => {
  async function call(request: Request): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, authEnv(), ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("GET list and POST refresh leave status alone and never call Cloudflare", async () => {
    const cookie = await adminCookie();
    // 10s old: the old on-read pipeline would have advanced this past checking_dns.
    await seedDomain({ cfHostnameId: "cf-1", createdAt: now() - 10_000 });

    const cfCalls = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes("api.cloudflare.com")) throw new Error("GET route hit CF");
        throw new Error("unexpected fetch");
      });

    const list = await call(
      new Request("http://localhost/api/orgs/org-1/domains", { headers: { cookie } }),
    );
    expect(list.status).toBe(200);
    expect((await statusOf("domain-1"))?.status).toBe("checking_dns");

    const refresh = await call(
      new Request("http://localhost/api/orgs/org-1/domains/domain-1/refresh", {
        method: "POST",
        headers: { cookie },
      }),
    );
    expect(refresh.status).toBe(200);
    expect((await statusOf("domain-1"))?.status).toBe("checking_dns");

    // No call reached the Cloudflare API from either read route.
    for (const c of cfCalls.mock.calls) expect(String(c[0])).not.toContain("api.cloudflare.com");
  });
});
