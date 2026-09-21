import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { applyTestMigrations, authEnv, freeOwnerCookie, jsonBody } from "./support";
import type { ApiKeyDTO } from "../../src/shared/types";

async function call(
  method: string,
  path: string,
  init: { cookie?: string; authorization?: string; body?: unknown } = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.authorization) headers.authorization = init.authorization;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("API keys (#131)", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  it("mints a key that authenticates the same org routes a session would", async () => {
    const cookie = await freeOwnerCookie();
    const minted = await call("POST", "/api/orgs/org-1/api-keys", {
      cookie,
      body: { name: "test connector" },
    });
    expect(minted.status).toBe(201);
    const key = await jsonBody<ApiKeyDTO>(minted);
    expect(key.key).toMatch(/^rdyrct_live_/);

    const res = await call("GET", "/api/orgs/org-1/links", { authorization: `Bearer ${key.key}` });
    expect(res.status).toBe(200);
  });

  it("never shows the raw key again once listed", async () => {
    const cookie = await freeOwnerCookie();
    await call("POST", "/api/orgs/org-1/api-keys", { cookie, body: { name: "test connector" } });
    const listed = await call("GET", "/api/orgs/org-1/api-keys", { cookie });
    const keys = await jsonBody<ApiKeyDTO[]>(listed);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.key).toBeUndefined();
  });

  it("a revoked key stops authenticating (#139 done-when)", async () => {
    const cookie = await freeOwnerCookie();
    const minted = await call("POST", "/api/orgs/org-1/api-keys", {
      cookie,
      body: { name: "test connector" },
    });
    const key = await jsonBody<ApiKeyDTO>(minted);

    const revoked = await call("DELETE", `/api/orgs/org-1/api-keys/${key.id}`, { cookie });
    expect(revoked.status).toBe(200);

    const res = await call("GET", "/api/orgs/org-1/links", { authorization: `Bearer ${key.key}` });
    expect(res.status).toBe(401);
  });

  it("rejects a garbage bearer token rather than treating it as a session", async () => {
    const res = await call("GET", "/api/orgs/org-1/links", { authorization: "Bearer nonsense" });
    expect(res.status).toBe(401);
  });
});
