import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  overrideEnv,
  testDb,
} from "./support";
import type { Env } from "../../src/worker/env";
import { eq } from "drizzle-orm";
import * as schema from "../../src/worker/db/schema";
import {
  AVATAR_PREFIX,
  deleteUserAvatar,
  sweepOrphanQrLogos,
  storeUserAvatar,
} from "../../src/worker/storage";
import { captureStorageQueue } from "./support";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
const AVATAR_URL_RE = /^\/api\/user\/avatar(\?v=\d+)?$/;

// A real 1x1 transparent PNG (its IHDR is well-formed, so dimensions() reads it).
const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (ch) => ch.charCodeAt(0),
);

/** The same PNG with its IHDR width rewritten to `w`. */
function pngWithWidth(w: number): Uint8Array {
  const b = PNG_1x1.slice();
  new DataView(b.buffer).setUint32(16, w);
  return b;
}

describe("storeUserAvatar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a non-Google, non-emulator host without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const got = await storeUserAvatar(env, "user-1", "https://evil.example.com/pic.jpg");
    expect(got).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-image content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { headers: { "content-type": "text/html" } })),
    );
    const got = await storeUserAvatar(env, "user-1", "https://lh3.googleusercontent.com/p");
    expect(got).toBeNull();
  });

  it("stores a JPEG from Google and returns the serving URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } })),
    );
    const got = await storeUserAvatar(env, "user-1", "https://lh3.googleusercontent.com/p");
    expect(got).toMatch(AVATAR_URL_RE);
    const obj = await env.MEDIA.get(`${AVATAR_PREFIX}user-1`);
    expect(obj).not.toBeNull();
    expect(obj!.httpMetadata!.contentType).toBe("image/jpeg");
  });

  it("stores from the emulator host in dev", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } })),
    );
    const e = overrideEnv({ GOOGLE_EMULATOR_URL: "http://localhost:9999" });
    const got = await storeUserAvatar(e, "user-2", "http://localhost:9999/avatars/u2");
    expect(got).toMatch(AVATAR_URL_RE);
  });
});

describe("deleteUserAvatar", () => {
  it("deletes the object and enqueues a prefix delete", async () => {
    await env.MEDIA.put(`${AVATAR_PREFIX}user-3`, JPEG);
    const { queue, sent } = captureStorageQueue();
    const e = overrideEnv({ STORAGE_QUEUE: queue });
    await deleteUserAvatar(e, "user-3");
    expect(await env.MEDIA.get(`${AVATAR_PREFIX}user-3`)).toBeNull();
    expect(sent).toEqual([{ op: "r2_delete_prefix", prefix: `${AVATAR_PREFIX}user-3` }]);
  });
});

describe("POST/DELETE /api/user/avatar", () => {
  beforeEach(applyTestMigrations);
  afterEach(() => reset());

  const upload = (cookie: string, body: BodyInit, type: string) =>
    fetchWorker(
      new Request("http://localhost/api/user/avatar", {
        method: "POST",
        headers: { cookie, "content-type": type },
        body,
      }),
    );

  it("stores an uploaded PNG and points user.image at it", async () => {
    const cookie = await freeOwnerCookie();
    const res = await upload(cookie, PNG_1x1, "image/png");
    expect(res.status).toBe(200);
    // SAFETY: the 200 branch of POST /api/user/avatar returns `{ image }`.
    const { image } = (await res.json()) as { image: string };
    expect(image).toMatch(AVATAR_URL_RE);

    const obj = await env.MEDIA.get(`${AVATAR_PREFIX}free-1`);
    expect(obj?.httpMetadata?.contentType).toBe("image/png");
    const [row] = await testDb().select().from(schema.user).where(eq(schema.user.id, "free-1"));
    expect(row.image).toBe(image);
  });

  it("rejects a body whose bytes are not an image", async () => {
    const cookie = await freeOwnerCookie();
    const res = await upload(cookie, "not an image", "image/png");
    expect(res.status).toBe(400);
    expect(await env.MEDIA.get(`${AVATAR_PREFIX}free-1`)).toBeNull();
  });

  it("rejects an image larger than the max dimension", async () => {
    const cookie = await freeOwnerCookie();
    const res = await upload(cookie, pngWithWidth(1024), "image/png");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("512px");
    expect(await env.MEDIA.get(`${AVATAR_PREFIX}free-1`)).toBeNull();
  });

  it("401s an unauthenticated upload", async () => {
    const res = await upload("", PNG_1x1, "image/png");
    expect(res.status).toBe(401);
  });

  it("DELETE clears the object and user.image", async () => {
    const cookie = await freeOwnerCookie();
    await upload(cookie, PNG_1x1, "image/png");

    const res = await fetchWorker(
      new Request("http://localhost/api/user/avatar", { method: "DELETE", headers: { cookie } }),
    );
    expect(res.status).toBe(204);
    expect(await env.MEDIA.get(`${AVATAR_PREFIX}free-1`)).toBeNull();
    const [row] = await testDb().select().from(schema.user).where(eq(schema.user.id, "free-1"));
    expect(row.image).toBeNull();
  });
});

describe("GET /api/user/avatar", () => {
  beforeEach(applyTestMigrations);
  afterEach(() => reset());

  const get = (cookie: string, testEnv?: Env) =>
    fetchWorker(new Request("http://localhost/api/user/avatar", { headers: { cookie } }), testEnv);

  const put = (cookie: string) =>
    fetchWorker(
      new Request("http://localhost/api/user/avatar", {
        method: "POST",
        headers: { cookie, "content-type": "image/png" },
        body: PNG_1x1,
      }),
    );

  it("serves the stored picture with a cacheable header", async () => {
    const cookie = await freeOwnerCookie();
    await put(cookie);
    const res = await get(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("degrades to 503 when the R2 read throws", async () => {
    const cookie = await freeOwnerCookie();
    await put(cookie);
    // SAFETY: the GET handler only calls MEDIA.get; every other member is
    // untouched on this path, so the partial proxy stands in for R2Bucket.
    const fakeMedia = new Proxy(env.MEDIA, {
      get(_t, prop) {
        if (prop === "get")
          return async () => {
            throw new Error("get: Reduce your rate of simultaneous reads (10058)");
          };
        return undefined;
      },
    }) as R2Bucket;
    const res = await get(cookie, { ...authEnv(), MEDIA: fakeMedia });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
  });
});

describe("sweepOrphanQrLogos", () => {
  beforeEach(applyTestMigrations);

  it("never deletes objects under the avatars/ prefix", async () => {
    const deleted: string[] = [];
    // SAFETY: the fake only needs `list` (returns two old objects, one under
    // avatars/) and `delete` (recorded); sweepOrphanQrLogos touches no other
    // R2Bucket member, so the proxy is safe to treat as a full R2Bucket.
    const fakeMedia = new Proxy(env.MEDIA, {
      get(_target, prop) {
        if (prop === "list")
          return async () => ({
            objects: [
              { key: `${AVATAR_PREFIX}user-1`, uploaded: new Date(Date.now() - 48 * 3600 * 1000) },
              { key: "org-1/logo.webp", uploaded: new Date(Date.now() - 48 * 3600 * 1000) },
            ],
            truncated: false,
          });
        if (prop === "delete")
          return async (keys: string | string[]) => {
            deleted.push(...(Array.isArray(keys) ? keys : [keys]));
          };
        return undefined;
      },
    }) as R2Bucket;
    const e = overrideEnv({ MEDIA: fakeMedia });
    const count = await sweepOrphanQrLogos(e);
    expect(count).toBe(1);
    expect(deleted).toEqual(["org-1/logo.webp"]);
  });
});
