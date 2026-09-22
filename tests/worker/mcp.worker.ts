import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { applyTestMigrations, authEnv, freeOwnerCookie, jsonBody } from "./support";
import type { ApiKeyDTO, JsonValue } from "../../src/shared/types";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: { name: string; arguments: Record<string, JsonValue> };
}

interface JsonRpcResponse {
  result?: {
    content?: { type: string; text?: string }[];
    isError?: boolean;
    tools?: { name: string }[];
  };
  error?: { message: string };
}

async function mintKey(cookie: string): Promise<ApiKeyDTO> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/orgs/org-1/api-keys", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "mcp test key" }),
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return jsonBody<ApiKeyDTO>(res);
}

async function revokeKey(cookie: string, keyId: string): Promise<void> {
  const ctx = createExecutionContext();
  await worker.fetch(
    new Request(`http://localhost/api/orgs/org-1/api-keys/${keyId}`, {
      method: "DELETE",
      headers: { cookie },
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

async function callMcp(authorization: string | undefined, body: JsonRpcRequest): Promise<Response> {
  const ctx = createExecutionContext();
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  if (authorization) headers.set("authorization", authorization);
  const res = await worker.fetch(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

function toolCall(name: string, args: Record<string, JsonValue>): JsonRpcRequest {
  return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
}

describe("remote MCP server (#139)", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  it("401s with no Authorization header", async () => {
    const res = await callMcp(undefined, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });

  it("lists the connector tools", async () => {
    const cookie = await freeOwnerCookie();
    const { key } = await mintKey(cookie);
    const res = await callMcp(`Bearer ${key}`, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(200);
    const body = await jsonBody<JsonRpcResponse>(res);
    const names = (body.result?.tools ?? []).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "create_link",
        "update_link",
        "delete_link",
        "list_links",
        "get_link_stats",
        "get_org_stats",
        "get_plan_usage",
        "invite_member",
        "generate_qr_code",
      ]),
    );
  });

  it('create_link makes a real link, matching "shorten this link for me"', async () => {
    const cookie = await freeOwnerCookie();
    const { key } = await mintKey(cookie);
    const res = await callMcp(
      `Bearer ${key}`,
      toolCall("create_link", { destination: "https://example.com/promo" }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<JsonRpcResponse>(res);
    expect(body.result?.isError).toBeFalsy();
    const dto = JSON.parse(body.result!.content![0]!.text!);
    expect(dto.destination).toBe("https://example.com/promo");

    // The org's sole organization is assumed with no org_id given.
    const list = await callMcp(`Bearer ${key}`, toolCall("list_links", {}));
    const listBody = await jsonBody<JsonRpcResponse>(list);
    const links = JSON.parse(listBody.result!.content![0]!.text!);
    expect(links).toHaveLength(1);
  });

  it("get_plan_usage answers the free plan's cap without a round trip through the API", async () => {
    const cookie = await freeOwnerCookie();
    const { key } = await mintKey(cookie);
    const res = await callMcp(`Bearer ${key}`, toolCall("get_plan_usage", {}));
    const body = await jsonBody<JsonRpcResponse>(res);
    const usage = JSON.parse(body.result!.content![0]!.text!);
    expect(usage).toEqual({ plan: "free", allowed: 30, used: 0, left: 30 });
  });

  it("generate_qr_code returns an image, needing no organization", async () => {
    const cookie = await freeOwnerCookie();
    const { key } = await mintKey(cookie);
    const res = await callMcp(
      `Bearer ${key}`,
      toolCall("generate_qr_code", { url: "https://example.com" }),
    );
    const body = await jsonBody<JsonRpcResponse>(res);
    expect(body.result?.content?.[0]?.type).toBe("image");
  });

  it("a revoked key's tool calls fail the same way the API would", async () => {
    const cookie = await freeOwnerCookie();
    const { id, key } = await mintKey(cookie);
    const res = await callMcp(`Bearer ${key}`, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(200);

    await revokeKey(cookie, id);

    const after = await callMcp(`Bearer ${key}`, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(after.status).toBe(401);
  });

  // Security-audit regressions: an oversized body or an unbounded QR url both
  // reach generate_qr_code with no org-membership check gating them, so these
  // are its only cost controls (see docs/mcp-server.md history / #139 audit).
  it("413s an oversized JSON-RPC body instead of buffering it", async () => {
    const cookie = await freeOwnerCookie();
    const { key } = await mintKey(cookie);
    const res = await callMcp(
      `Bearer ${key}`,
      toolCall("generate_qr_code", { url: `https://example.com/${"a".repeat(64 * 1024)}` }),
    );
    expect(res.status).toBe(413);
  });

  it("rejects a generate_qr_code url over the length cap before it reaches the encoder", async () => {
    const cookie = await freeOwnerCookie();
    const { key } = await mintKey(cookie);
    const res = await callMcp(
      `Bearer ${key}`,
      toolCall("generate_qr_code", { url: `https://example.com/${"a".repeat(2048)}` }),
    );
    const body = await jsonBody<JsonRpcResponse>(res);
    expect(body.result?.isError).toBe(true);
  });

  it("a tool error thrown after an await (not a bad argument) still comes back clean", async () => {
    const cookie = await freeOwnerCookie();
    const { key } = await mintKey(cookie);
    // resolveOrg's membership check runs an awaited DB query before it
    // throws, unlike the argument-validation errors above: a different
    // shape of error path through the same handler.
    const res = await callMcp(
      `Bearer ${key}`,
      toolCall("get_link_stats", { slug: "sale", org_id: "not-my-org" }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<JsonRpcResponse>(res);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain("not a member");
  });

  // get_link_stats/get_org_stats used to return the dashboard's own DTO
  // unfiltered: a year of daily series, deltas, rangeDays, and (for the org
  // one) an hourSeries, heatmap and UTM breakdowns nobody asked for. Locks
  // in that the trim stays a trim, not just that the promised fields exist.
  it("get_link_stats and get_org_stats answer only what their descriptions promise", async () => {
    const cookie = await freeOwnerCookie();
    const { key } = await mintKey(cookie);
    const created = await callMcp(
      `Bearer ${key}`,
      toolCall("create_link", { destination: "https://example.com/promo" }),
    );
    const createdBody = await jsonBody<JsonRpcResponse>(created);
    const { slug } = JSON.parse(createdBody.result!.content![0]!.text!);

    const linkRes = await callMcp(`Bearer ${key}`, toolCall("get_link_stats", { slug }));
    const linkBody = await jsonBody<JsonRpcResponse>(linkRes);
    const linkStats = JSON.parse(linkBody.result!.content![0]!.text!);
    expect(linkStats).toEqual({
      slug,
      domain: null,
      destination: "https://example.com/promo",
      title: "",
      totalClicks: 0,
      clicks7d: 0,
      lastClick: null,
      countries: [],
      referrers: [],
      devices: [],
    });

    const orgRes = await callMcp(`Bearer ${key}`, toolCall("get_org_stats", {}));
    const orgBody = await jsonBody<JsonRpcResponse>(orgRes);
    const orgStats = JSON.parse(orgBody.result!.content![0]!.text!);
    expect(orgStats).toEqual({
      totalClicks: 0,
      totalLinks: 1,
      clicks7d: 0,
      topLinks: [],
      deadLinks: [],
    });
  });
});
