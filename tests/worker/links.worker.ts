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
