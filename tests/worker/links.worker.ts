import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { applyTestMigrations, authEnv, freeOwnerCookie, jsonBody } from "./support";
import type { JsonValue } from "../../src/shared/types";

async function postLink(cookie: string, body: JsonValue): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/orgs/org-1/links", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function patchLink(cookie: string, linkId: string, body: JsonValue): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost/api/orgs/org-1/links/${linkId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST /orgs/:orgId/links: QR gate on the free plan", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  it("succeeds when qrLogoSize is null, same as the link editor always sends it", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postLink(cookie, { destination: "https://example.com", qrLogoSize: null });
    expect(res.status).toBe(201);
  });

  it("still 402s when a real QR override is set", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postLink(cookie, {
      destination: "https://example.com",
      qrLogoSize: null,
      qrStyle: "dots",
    });
    expect(res.status).toBe(402);
  });
});

describe("PATCH /orgs/:orgId/links/:linkId", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  it("merges a partial update: only the given fields change, the rest keep their existing value", async () => {
    const cookie = await freeOwnerCookie();
    const created = await postLink(cookie, {
      destination: "https://example.com/original",
      title: "Original title",
    });
    const { id } = await jsonBody<{ id: string }>(created);

    const res = await patchLink(cookie, id, { title: "Updated title" });
    expect(res.status).toBe(200);
    const updated = await jsonBody<{ title: string; destination: string }>(res);
    expect(updated.title).toBe("Updated title");
    expect(updated.destination).toBe("https://example.com/original");
  });
});

describe("link quota usage returned by mutations (#100)", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  it("create and delete each answer with the org's fresh count", async () => {
    const cookie = await freeOwnerCookie();

    const created = await postLink(cookie, { destination: "https://example.com/a" });
    const link = await jsonBody<{ id: string; quotaUsage: number; quotaUsageAt: number }>(created);
    expect(link.quotaUsage).toBe(1);
    expect(link.quotaUsageAt).toBeGreaterThan(0);

    const patched = await patchLink(cookie, link.id, { title: "Renamed" });
    const updated = await jsonBody<{ quotaUsage: number; quotaUsageAt: number }>(patched);
    expect(updated.quotaUsage).toBe(1);
    // Each read is a fresh Date.now(), so a later mutation's response never
    // carries an earlier timestamp: the client uses this to drop a stale,
    // out-of-order response instead of clobbering a fresher one.
    expect(updated.quotaUsageAt).toBeGreaterThanOrEqual(link.quotaUsageAt);

    const ctx = createExecutionContext();
    const deleted = await worker.fetch(
      new Request(`http://localhost/api/orgs/org-1/links/${link.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      authEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const removed = await jsonBody<{ quotaUsage: number; quotaUsageAt: number }>(deleted);
    expect(removed.quotaUsage).toBe(0);
    expect(removed.quotaUsageAt).toBeGreaterThanOrEqual(updated.quotaUsageAt);
  });
});
