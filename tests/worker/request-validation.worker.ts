import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { applyTestMigrations, authEnv, fetchWorker, freeOwnerCookie, jsonBody } from "./support";
import type { JsonValue } from "../../src/shared/types";

async function postJson(cookie: string, path: string, body: JsonValue): Promise<Response> {
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

/** A body that gets past the upload route's own sniffing, so the only thing
 * a test exercises is the size limit. */
function webpBody(bytes: number): Uint8Array {
  const webp = new Uint8Array(bytes);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  return webp;
}

async function uploadLogo(cookie: string, contentType: string, body: Uint8Array) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/orgs/org-1/qr-logo", {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body,
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("request body size limit (#19)", () => {
  it("rejects an oversized JSON body with 413 before the handler runs", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postJson(cookie, "/api/orgs", {
      name: "a".repeat(64 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it("lets a QR logo through that is larger than the JSON ceiling", async () => {
    // The org router's 32 KB JSON limit used to run first and fail every logo.
    const res = await uploadLogo(await freeOwnerCookie(), "image/webp", webpBody(64 * 1024));
    expect(res.status).not.toBe(413);
  });

  it("holds a mixed-case JSON content type to the JSON ceiling", async () => {
    // A case-sensitive "json" check let a caller opt out of the limit by
    // changing the case of their own header.
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
    const res = await uploadLogo(await freeOwnerCookie(), "IMAGE/WEBP", webpBody(64 * 1024));
    expect(res.status).not.toBe(413);
  });

  it("rejects an oversized QR logo upload with 413", async () => {
    // A real WebP body, so a 413 proves the size limit rather than a
    // sniffing check rejecting a zero-filled buffer.
    const res = await uploadLogo(await freeOwnerCookie(), "image/webp", webpBody(300 * 1024));
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

// A scalar is valid JSON, so the parse never fails; it names no fields, so the
// route's own 400 is right, not a ValiError 500.
describe("a JSON body that is not an object (#122)", () => {
  it.each([
    ['"foo"', "a string"],
    ["42", "a number"],
    ["true", "a boolean"],
  ])("answers %s (%s) with the route's own 400, not a 500", async (rawBody) => {
    const res = await postRawBody("", "/api/shorten", rawBody);
    expect(res.status).toBe(400);
    const { message } = await jsonBody<{ message: string }>(res);
    expect(message).toBe("Paste a link to shorten");
  });

  it("answers an array the same way, since it names no fields either", async () => {
    const res = await postRawBody("", "/api/shorten", "[]");
    expect(res.status).toBe(400);
  });
});
