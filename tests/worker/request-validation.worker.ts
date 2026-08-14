import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { applyTestMigrations, authEnv, fetchWorker, freeOwnerCookie } from "./support";

async function postJson(cookie: string, path: string, body: unknown): Promise<Response> {
  return fetchWorker(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function postRawBody(cookie: string, path: string, rawBody: string): Promise<Response> {
  return fetchWorker(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: rawBody,
    }),
  );
}

beforeEach(applyTestMigrations);
afterEach(reset);

describe("request body size limit (#19)", () => {
  it("rejects an oversized JSON body with 413 before the handler runs", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postJson(cookie, "/api/orgs", {
      name: "a".repeat(64 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it("lets a QR logo through that is larger than the JSON ceiling", async () => {
    // The bug this pins: /orgs/:orgId/qr-logo sits under the org router, so
    // the org router's JSON limit (32 KB) ran first and answered "Request
    // body too large" for a perfectly ordinary logo. A 512x512 WebP is
    // routinely bigger than that, which made every logo upload fail.
    const cookie = await freeOwnerCookie();
    const ctx = createExecutionContext();
    const webp = new Uint8Array(64 * 1024);
    // A real RIFF/WEBP header, so the route gets past its own sniffing and
    // the only thing under test is the size limit.
    webp.set(new TextEncoder().encode("RIFF"), 0);
    webp.set(new TextEncoder().encode("WEBP"), 8);
    const res = await worker.fetch(
      new Request("http://localhost/api/orgs/org-1/qr-logo", {
        method: "POST",
        headers: { cookie, "content-type": "image/webp" },
        body: webp,
      }),
      authEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(413);
  });

  it("holds a mixed-case JSON content type to the JSON ceiling", async () => {
    // `Application/JSON` is valid, and the check used to ask whether the raw
    // header contained "json", case-sensitively. It did not, so the request
    // was treated as a file and got 260 KB instead of 32: a caller could opt
    // out of the JSON limit by changing the case of their own header. It
    // asks whether the type is an image now, so anything unrecognized falls
    // to the tighter ceiling rather than the looser one.
    const cookie = await freeOwnerCookie();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://localhost/api/orgs", {
        method: "POST",
        headers: { cookie, "content-type": "Application/JSON; charset=UTF-8" },
        body: JSON.stringify({ name: "a".repeat(64 * 1024) }),
      }),
      authEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(413);
  });

  it("still lets an upload through on a mixed-case image type", async () => {
    const cookie = await freeOwnerCookie();
    const ctx = createExecutionContext();
    const webp = new Uint8Array(64 * 1024);
    webp.set(new TextEncoder().encode("RIFF"), 0);
    webp.set(new TextEncoder().encode("WEBP"), 8);
    const res = await worker.fetch(
      new Request("http://localhost/api/orgs/org-1/qr-logo", {
        method: "POST",
        headers: { cookie, "content-type": "IMAGE/WEBP" },
        body: webp,
      }),
      authEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(413);
  });

  it("rejects an oversized QR logo upload with 413", async () => {
    const cookie = await freeOwnerCookie();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://localhost/api/orgs/org-1/qr-logo", {
        method: "POST",
        headers: { cookie, "content-type": "image/webp" },
        body: new Uint8Array(300 * 1024),
      }),
      authEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(413);
  });
});

describe("org name validation (#19)", () => {
  it("rejects a name over 100 characters", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postJson(cookie, "/api/orgs", { name: "a".repeat(101) });
    expect(res.status).toBe(400);
  });

  it("accepts a name at exactly 100 characters", async () => {
    const cookie = await freeOwnerCookie();
    // free plan's org cap is 1 and this user already owns org-1, so the
    // request fails on the plan-limit check, not the name: proves the name
    // itself passed validation.
    const res = await postJson(cookie, "/api/orgs", { name: "a".repeat(100) });
    expect(res.status).toBe(402);
  });

  it("rejects a non-string name with 400 instead of a 500 from calling .trim() on it", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postJson(cookie, "/api/orgs", { name: 1 });
    expect(res.status).toBe(400);
  });
});

describe("invite creation request validation (#19)", () => {
  it("rejects an emails array over the cap", async () => {
    const cookie = await freeOwnerCookie();
    const emails = Array.from({ length: 51 }, (_, i) => `user${i}@example.com`);
    const res = await postJson(cookie, "/api/orgs/org-1/invites", { emails });
    expect(res.status).toBe(400);
  });

  it("rejects a non-array emails field instead of throwing a 500", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postJson(cookie, "/api/orgs/org-1/invites", { emails: "not-an-array" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-string element instead of throwing a 500", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postJson(cookie, "/api/orgs/org-1/invites", { emails: [123, 456] });
    expect(res.status).toBe(400);
  });

  it("still creates a bearer invite when emails is omitted", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postJson(cookie, "/api/orgs/org-1/invites", {});
    expect(res.status).toBe(201);
  });

  it("rejects malformed JSON with 400 instead of silently creating a bearer invite", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postRawBody(cookie, "/api/orgs/org-1/invites", "{not valid json");
    expect(res.status).toBe(400);
  });
});
