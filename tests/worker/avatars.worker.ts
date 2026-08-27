import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyTestMigrations, overrideEnv } from "./support";
import {
  AVATAR_PREFIX,
  avatarUrl,
  deleteUserAvatar,
  sweepOrphanQrLogos,
  storeUserAvatar,
} from "../../src/worker/storage";
import { captureStorageQueue } from "./support";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);

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
    expect(got).toBe(avatarUrl());
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
    expect(got).toBe(avatarUrl());
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
