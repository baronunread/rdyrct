import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import { ensureHostname, probeDelaySeconds, probeDomain } from "../../src/worker/routes/domains";
import {
  adminCookie,
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overrideEnv,
} from "./support";
import type { JsonValue } from "../../src/shared/types";

// Env with a token present and the dev fake off, so the real get-or-create
// path runs against a mocked global fetch.
const realCfEnv = () =>
  overrideEnv({ CF_ZONE_ID: "zone", CF_API_TOKEN: "tok", CF_DEV_ENV: undefined });

// CF_DEV_ENV=simulated, independent of whatever CF_API_TOKEN/CF_DEV_ENV happen
// to be in the ambient .dev.vars, so the CF fake is used on its timer.
const fakeCfEnv = () => overrideEnv({ CF_DEV_ENV: "simulated" });

const cfJson = (body: JsonValue) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Whether a mocked fetch call matches one of the three custom-hostname
 * routes this test double stands in for. */
function matchesRoute(method: string, url: string, target: "GET" | "POST" | "DELETE"): boolean {
  if (method !== target) return false;
  if (target === "GET") return url.includes("/custom_hostnames?hostname=");
  if (target === "POST") return url.endsWith("/custom_hostnames");
  return url.includes("/custom_hostnames/");
}

function mockCustomHostnames(handlers: {
  get?: () => Response | Promise<Response>;
  post?: () => Response | Promise<Response>;
  delete?: (url: string) => Response | Promise<Response>;
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (matchesRoute(method, url, "GET") && handlers.get) return handlers.get();
    if (matchesRoute(method, url, "POST") && handlers.post) return handlers.post();
    if (matchesRoute(method, url, "DELETE") && handlers.delete) return handlers.delete(url);
    throw new Error(`unexpected ${method} ${url}`);
  });
}

async function seedDomain(overrides: Partial<typeof schema.domains.$inferInsert> = {}) {
  const row: typeof schema.domains.$inferInsert = {
    id: "domain-1",
    orgId: "org-1",
    hostname: "go.example.com",
    status: "checking_dns",
    cfHostnameId: null,
    createdAt: Date.now(),
    ...overrides,
  };
  await env.DB.batch([
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Test', 0)"),
    env.DB.prepare(
      "insert into domains (id, org_id, hostname, status, status_reason, validation, cf_hostname_id, checking_since, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      row.id,
      row.orgId,
      row.hostname,
      row.status,
      row.statusReason ?? "",
      row.validation ?? "http",
      row.cfHostnameId,
      row.checkingSince ?? null,
      row.createdAt,
    ),
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
    mockCustomHostnames({
      get: () => cfJson({ result: [] }),
      post: () => {
        creates++;
        return cfJson({ result: { id: "cf-new" } });
      },
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
    mockCustomHostnames({
      get: () => cfJson({ result: [{ id: "cf-first", hostname: "go.example.com" }] }),
      post: () => {
        creates++;
        return cfJson({ result: { id: "cf-second" } });
      },
    });

    const id = await ensureHostname(realCfEnv(), "domain-1", "go.example.com");
    expect(id).toBe("cf-first");
    expect(creates).toBe(0);
    expect((await statusOf("domain-1"))?.cf_hostname_id).toBe("cf-first");
  });

  it("compensates by deleting the hostname when the domain is removed mid-activation", async () => {
    await seedDomain();
    const deleted: string[] = [];
    mockCustomHostnames({
      get: () => cfJson({ result: [] }),
      post: async () => {
        // The user deletes the domain in the window between create and persist.
        await env.DB.prepare("delete from domains where id = 'domain-1'").run();
        return cfJson({ result: { id: "cf-orphan" } });
      },
      delete: (url) => {
        if (!url.endsWith("/custom_hostnames/cf-orphan"))
          throw new Error(`unexpected DELETE ${url}`);
        deleted.push("cf-orphan");
        return cfJson({ result: { id: "cf-orphan" } });
      },
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

  it("fails closed instead of faking Cloudflare when credentials are missing and CF_DEV_ENV is unset", async () => {
    await seedDomain();
    const misconfigured = overrideEnv({
      CF_API_TOKEN: undefined,
      CF_ZONE_ID: undefined,
      CF_DEV_ENV: undefined,
    });
    await expect(ensureHostname(misconfigured, "domain-1", "go.example.com")).rejects.toThrow(
      "Custom domains are not configured on this deployment",
    );
  });
});

describe("probeDomain: one durable step at a time", () => {
  it("advances checking_dns to issuing_tls, then to active (fake CF)", async () => {
    // createdAt 21s ago: the fake reports DNS + TLS as ready, and it is well
    // under the 24h deadline.
    await seedDomain({ createdAt: Date.now() - 21_000 });

    const first = await probeDomain(fakeCfEnv(), "domain-1");
    expect(first).toEqual({ state: "pending", status: "issuing_tls" });
    expect((await statusOf("domain-1"))?.status).toBe("issuing_tls");

    const second = await probeDomain(fakeCfEnv(), "domain-1");
    expect(second).toEqual({ state: "active" });
    expect((await statusOf("domain-1"))?.status).toBe("active");
  });

  it("leaves checking_dns in place while the fake DNS is still pending", async () => {
    await seedDomain({ createdAt: Date.now() }); // age < 5s: fake DNS not resolved yet
    const probe = await probeDomain(fakeCfEnv(), "domain-1");
    expect(probe).toEqual({ state: "pending", status: "checking_dns" });
    expect((await statusOf("domain-1"))?.status).toBe("checking_dns");
  });

  it("fails a domain that has not resolved within the deadline", async () => {
    await seedDomain({ createdAt: Date.now() - 25 * 60 * 60 * 1000 }); // 25h old
    const probe = await probeDomain(fakeCfEnv(), "domain-1");
    expect(probe.state).toBe("error");
    const after = await statusOf("domain-1");
    expect(after?.status).toBe("error");
    expect(after?.status_reason).toContain("CNAME");
  });

  it("counts the deadline from a retry, not from when the domain was added", async () => {
    await seedDomain({ createdAt: Date.now() - 25 * 60 * 60 * 1000, checkingSince: Date.now() });
    const probe = await probeDomain(fakeCfEnv(), "domain-1");
    expect(probe.state).not.toBe("error");
  });

  it("reports active and error as terminal without re-checking", async () => {
    await seedDomain({ status: "active", cfHostnameId: "cf-1", createdAt: Date.now() });
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

  it("slows to every 15 minutes after about a day of 5-minute checks", () => {
    expect(probeDelaySeconds(7 + 287)).toBe(300);
    expect(probeDelaySeconds(7 + 288)).toBe(900);
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
    await seedDomain({ cfHostnameId: "cf-1", createdAt: Date.now() - 10_000 });

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
      new Request("http://localhost/api/orgs/org-1/domains/domain-1", {
        headers: { cookie },
      }),
    );
    expect(refresh.status).toBe(200);
    expect((await statusOf("domain-1"))?.status).toBe("checking_dns");

    // No call reached the Cloudflare API from either read route.
    for (const c of cfCalls.mock.calls) expect(String(c[0])).not.toContain("api.cloudflare.com");
  });
});

describe("trying a failed domain again", () => {
  async function retry(cookie: string): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://localhost/api/orgs/org-1/domains/domain-1/retry", {
        method: "POST",
        headers: { cookie },
      }),
      authEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("restarts the check with a fresh deadline, keeping the domain", async () => {
    const cookie = await adminCookie();
    await seedDomain({
      status: "error",
      statusReason: "We never saw the TXT records.",
      validation: "txt",
      cfHostnameId: "cf-1",
      createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });
    const before = Date.now();
    const res = await retry(cookie);
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; checkUntil: number }>();
    expect(body.status).toBe("checking_dns");
    expect(body.checkUntil).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);

    const row = await env.DB.prepare(
      "select status, status_reason, checking_since, cf_hostname_id from domains where id = 'domain-1'",
    ).first<{
      status: string;
      status_reason: string;
      checking_since: number;
      cf_hostname_id: string | null;
    }>();
    expect(row?.status).toBe("checking_dns");
    expect(row?.status_reason).toBe("");
    expect(row?.checking_since).toBeGreaterThanOrEqual(before);
    // Looked up again by the new activation, in case Cloudflare dropped it.
    expect(row?.cf_hostname_id).toBeNull();
  });

  it("refuses a domain beyond the plan, which stays as it is", async () => {
    const cookie = await adminCookie();
    await seedDomain({ status: "error", cfHostnameId: "cf-1", createdAt: Date.now() });
    await env.DB.prepare("update domains set locked_at = 1 where id = 'domain-1'").run();
    expect((await retry(cookie)).status).toBe(409);
    expect((await statusOf("domain-1"))?.status).toBe("error");
  });

  it("does not reach another organization's domain", async () => {
    const cookie = await adminCookie();
    await env.DB.prepare(
      "insert into orgs (id, name, created_at) values ('org-2', 'Other', 0)",
    ).run();
    await seedDomain({ status: "error", cfHostnameId: "cf-1", createdAt: Date.now() });
    await env.DB.prepare("update domains set org_id = 'org-2' where id = 'domain-1'").run();
    expect((await retry(cookie)).status).toBe(404);
    expect((await statusOf("domain-1"))?.status).toBe("error");
  });

  it("refuses a domain that has not failed", async () => {
    const cookie = await adminCookie();
    await seedDomain({ cfHostnameId: "cf-1", createdAt: Date.now() });
    expect((await retry(cookie)).status).toBe(409);
    expect((await statusOf("domain-1"))?.status).toBe("checking_dns");
  });
});

describe("adding a domain rejects either of this app's own hosts", () => {
  // Well-formed hostnames (the ambient "localhost"/"short.localhost" test
  // bindings would fail the format check first, never reaching the check
  // this describes).
  const ownHostsEnv = () =>
    overrideEnv({ APP_HOST: "app.example.com", SHARED_LINK_HOST: "short.example.com" });

  async function call(request: Request): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await worker.fetch(request, ownHostsEnv(), ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it.each(["app.example.com", "short.example.com"])("rejects %s", async (hostname) => {
    const cookie = await adminCookie();
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Test', 0)"),
      // Admin owns it (pro plan), so assertDomainQuota's paid-feature check
      // passes before the hostname is even looked at.
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'admin-1', 'owner', 0)",
      ),
    ]);

    const res = await call(
      new Request("http://localhost/api/orgs/org-1/domains", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ hostname }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("PATCH /domains/:id root redirect (#488)", () => {
  // It answers for the bare host and every slug the host does not know, so
  // it goes through the rules a link's destination does.
  async function setRoot(rootRedirect: string) {
    const cookie = await freeOwnerCookie({ id: "domain-1", hostname: "go.example.com" });
    return fetchWorker(
      new Request("http://localhost/api/orgs/org-1/domains/domain-1", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ rootRedirect }),
      }),
    );
  }
  const stored = async () =>
    (
      await env.DB.prepare("select root_redirect as r from domains where id = 'domain-1'").first<{
        r: string;
      }>()
    )?.r;

  it("saves an ordinary address", async () => {
    const res = await setRoot("acme.example");
    expect(res.status).toBe(200);
    expect(await stored()).toBe("https://acme.example");
  });

  it.each([
    ["another shortener", "https://bit.ly/abc", "shortener_destination"],
    ["one of our own short links", `https://${env.SHARED_LINK_HOST}/abc1234`, "own_short_link"],
    ["a blocked host", "https://scam.example/login", "blocked_destination"],
    ["a subdomain of a blocked host", "https://login.scam.example/", "blocked_destination"],
  ])("refuses %s, with the code the form marks its field from", async (_, url, code) => {
    await env.DB.prepare(
      "insert into blocked_hosts (host, reason, created_at) values ('scam.example', '', 0)",
    ).run();
    const res = await setRoot(url);
    expect(res.status).toBe(422);
    expect(await jsonBody<{ code?: string }>(res)).toMatchObject({ code });
    expect(await stored()).toBe("");
  });

  it("marks an address that is not one with its own code", async () => {
    const res = await setRoot("not a url");
    expect(res.status).toBe(400);
    expect(await jsonBody<{ code?: string }>(res)).toMatchObject({ code: "bad_destination" });
  });
});
