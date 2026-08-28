import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { env } from "cloudflare:workers";
import { getQueueResult, reset } from "cloudflare:test";
import { eq } from "drizzle-orm";
import * as schema from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import {
  applyStorageMessage,
  consumeStorageBatch,
  deleteKvKeys,
  deleteR2Prefix,
  deleteQrLogoMsg,
  enqueueStorage,
  logDeadLetterBatch,
  orgDeleteGather,
  syncLinkMsg,
  type StorageMessage,
  sweepOrphanQrLogos,
} from "../../src/worker/storage";
import {
  applyTestMigrations,
  batchOf,
  captureStorageQueue as captureQueue,
  overrideEnv,
  sampleLink,
  seedLink,
  stubQueue,
  testEnv,
} from "./support";

/**
 * The real object with a few members swapped out.
 *
 * Everything not named keeps working, so a test can prove one operation
 * misbehaved rather than that the whole binding was replaced. Methods are
 * re-bound to the target because a native Cloudflare binding rejects any other
 * receiver.
 */
function overriding<T extends object>(target: T, overrides: Partial<T>): T {
  return new Proxy(target, {
    get(actual, property) {
      // SAFETY: a `get` trap only ever runs for a key looked up on `actual`,
      // so the trap's key is a key of T.
      const key = property as keyof T;
      if (key in overrides) return overrides[key];
      const value = actual[key];
      return value instanceof Function ? value.bind(actual) : value;
    },
  });
}

const kvDown = async (): Promise<never> => {
  throw new Error("injected KV failure");
};

function failingKv(): KVNamespace {
  return overriding(env.LINKS, { put: kvDown, delete: kvDown });
}

function failingR2(): R2Bucket {
  return overriding(env.MEDIA, {
    delete: async () => {
      throw new Error("injected R2 failure");
    },
  });
}

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});

describe("storage queue: kv_sync", () => {
  it("publishes a link's key from D1 and is safe to run twice", async () => {
    const db = await seedLink();
    const message = syncLinkMsg(sampleLink.slug, null);

    await applyStorageMessage(testEnv, db, message);
    await applyStorageMessage(testEnv, db, message);

    expect(await env.LINKS.get("slug:sale", "json")).toMatchObject({
      linkId: "link-1",
      url: "https://example.com/",
    });
  });

  it("deletes the key when the row is gone, whatever order messages ran in", async () => {
    const db = await seedLink();
    const message = syncLinkMsg(sampleLink.slug, null);
    // Publish once so KV holds a value.
    await applyStorageMessage(testEnv, db, message);
    expect(await env.LINKS.get("slug:sale")).not.toBeNull();

    // Now delete the row and replay the SAME message. Because the consumer
    // reads current D1 truth, a stale "publish-era" message still lands on a
    // delete: no older message can revive a removed link.
    await db.delete(schema.links).where(eq(schema.links.id, "link-1"));
    await applyStorageMessage(testEnv, db, message);

    expect(await env.LINKS.get("slug:sale")).toBeNull();
  });

  it("reflects the latest destination no matter which sync runs last", async () => {
    const db = await seedLink("https://old.example.com");
    const message = syncLinkMsg(sampleLink.slug, null);
    await applyStorageMessage(testEnv, db, message);

    await db
      .update(schema.links)
      .set({ destination: "https://new.example.com" })
      .where(eq(schema.links.id, "link-1"));
    // Two identical messages, run after the update: both converge on the new value.
    await applyStorageMessage(testEnv, db, message);
    await applyStorageMessage(testEnv, db, message);

    expect(await env.LINKS.get("slug:sale", "json")).toMatchObject({
      url: "https://new.example.com/",
    });
  });
});

describe("storage queue: consumer retry", () => {
  it("retries the message when KV is down, then acks once KV recovers", async () => {
    const db = await seedLink();
    const { batch, ctx } = batchOf("rdyrct-storage", [syncLinkMsg(sampleLink.slug, null)]);

    await consumeStorageBatch(overrideEnv({ LINKS: failingKv() }), batch);
    const failed = await getQueueResult(batch, ctx);
    expect(failed.retryMessages).toHaveLength(1);
    expect(failed.explicitAcks).toEqual([]);
    expect(await env.LINKS.get("slug:sale")).toBeNull();

    const retry = batchOf("rdyrct-storage", [syncLinkMsg(sampleLink.slug, null)]);
    await consumeStorageBatch(testEnv, retry.batch);
    const succeeded = await getQueueResult(retry.batch, retry.ctx);
    expect(succeeded.explicitAcks).toHaveLength(1);
    expect(await env.LINKS.get("slug:sale")).not.toBeNull();
    void db;
  });

  it("retries an R2 delete under outage, then applies it", async () => {
    await env.MEDIA.put("org-1/logo.webp", "logo");
    const message = deleteQrLogoMsg("/api/orgs/org-1/qr-logo/logo.webp")!;

    const down = batchOf("rdyrct-storage", [message]);
    await consumeStorageBatch(overrideEnv({ MEDIA: failingR2() }), down.batch);
    const failed = await getQueueResult(down.batch, down.ctx);
    expect(failed.retryMessages).toHaveLength(1);
    expect(await env.MEDIA.head("org-1/logo.webp")).not.toBeNull();

    const up = batchOf("rdyrct-storage", [message]);
    await consumeStorageBatch(testEnv, up.batch);
    const succeeded = await getQueueResult(up.batch, up.ctx);
    expect(succeeded.explicitAcks).toHaveLength(1);
    expect(await env.MEDIA.head("org-1/logo.webp")).toBeNull();
  });
});

describe("storage queue: dead-letter visibility", () => {
  it("logs storage_message_dead_letter only on the last delivery", async () => {
    await seedLink();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = overrideEnv({ LINKS: failingKv() });
    const loggedDeadLetter = () =>
      errors.mock.calls.some(([a]) => String(a).includes("storage_message_dead_letter"));

    // An early delivery that fails retries without the dead-letter log.
    const early = batchOf("rdyrct-storage", [syncLinkMsg("sale", null)], 1);
    await consumeStorageBatch(down, early.batch);
    expect((await getQueueResult(early.batch, early.ctx)).retryMessages).toHaveLength(1);
    expect(loggedDeadLetter()).toBe(false);

    // The sixth (last) failing delivery logs that the message will dead-letter.
    const last = batchOf("rdyrct-storage", [syncLinkMsg("sale", null)], 6);
    await consumeStorageBatch(down, last.batch);
    expect((await getQueueResult(last.batch, last.ctx)).retryMessages).toHaveLength(1);
    expect(loggedDeadLetter()).toBe(true);
    errors.mockRestore();
  });

  it("acks every message and captures a Sentry alert once it reaches the dead-letter queue", async () => {
    const captureSpy = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");
    const { batch, ctx } = batchOf("rdyrct-storage-dlq", [
      syncLinkMsg("sale", null),
      deleteQrLogoMsg("/api/orgs/org-1/qr-logo/logo.webp")!,
    ]);

    await logDeadLetterBatch(testEnv, batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toHaveLength(2);
    expect(result.retryMessages).toEqual([]);
    expect(captureSpy).toHaveBeenCalledWith("storage_message_gave_up", {
      level: "error",
      extra: { op: "kv_sync", target: "slug:sale" },
    });
    captureSpy.mockRestore();
  });
});

describe("org teardown steps under secondary-store outage", () => {
  it("removes the org from D1 and keeps cleanup durable across an outage", async () => {
    const db = await seedLink();
    await env.LINKS.put("slug:sale", "stale");
    await env.MEDIA.put("org-1/logo.webp", "logo");

    // Step 1: gather while the org still exists.
    const gathered = await orgDeleteGather(db, "org-1");
    expect(gathered.kvKeys).toEqual(["slug:sale"]);

    // Step 2: the org leaves D1 immediately (the workflow's second step).
    await db.delete(schema.orgs).where(eq(schema.orgs.id, "org-1"));
    expect(await env.DB.prepare("select id from orgs where id = 'org-1'").first()).toBeNull();

    // Steps 3-5 under a full secondary-store outage: each throws, so the
    // workflow would retry that step. The org row is already gone.
    await expect(
      deleteKvKeys(overrideEnv({ LINKS: failingKv() }), gathered.kvKeys),
    ).rejects.toThrow("injected KV failure");
    await expect(deleteR2Prefix(overrideEnv({ MEDIA: failingR2() }), "org-1/")).rejects.toThrow(
      "injected R2 failure",
    );
    expect(await env.LINKS.get("slug:sale")).not.toBeNull();
    expect(await env.MEDIA.head("org-1/logo.webp")).not.toBeNull();

    // Once the stores recover the steps complete and are idempotent.
    await deleteKvKeys(testEnv, gathered.kvKeys);
    await deleteR2Prefix(testEnv, "org-1/");
    expect(await env.LINKS.get("slug:sale")).toBeNull();
    expect(await env.MEDIA.head("org-1/logo.webp")).toBeNull();
  });
});

describe("producing messages", () => {
  it("skips null messages and sends the rest as a batch", async () => {
    const { queue, sent } = captureQueue();
    await enqueueStorage(overrideEnv({ STORAGE_QUEUE: queue }), [
      syncLinkMsg("sale", null),
      null,
      deleteQrLogoMsg(""),
    ]);
    expect(sent).toEqual([{ op: "kv_sync", key: "slug:sale" }]);
  });

  it("propagates a producer-side send failure instead of swallowing it", async () => {
    const queue = stubQueue<StorageMessage>(() => {
      throw new Error("injected queue-send failure");
    });

    await expect(
      enqueueStorage(overrideEnv({ STORAGE_QUEUE: queue }), [syncLinkMsg("sale", null)]),
    ).rejects.toThrow("injected queue-send failure");
  });
});

describe("sweepOrphanQrLogos (#49)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** Puts a logo object in R2 and, optionally, backdates it past the grace
   * period. R2's `uploaded` is set by the store, so an old object is faked by
   * overriding list() rather than by waiting a day. */
  async function putLogo(key: string) {
    await env.MEDIA.put(key, new Uint8Array([1, 2, 3]));
  }

  /** The sweep only looks at objects older than the grace period, so run it
   * against an R2 whose listing reports every object as a day and a half old. */
  function agedEnv(): Env {
    const real = env.MEDIA;
    const uploaded = new Date(Date.now() - 1.5 * DAY_MS);
    const MEDIA = overriding(real, {
      list: async (options?: R2ListOptions) => {
        const page = await real.list(options);
        return overriding(page, {
          objects: page.objects.map((object) => overriding(object, { uploaded })),
        });
      },
    });
    return overrideEnv({ MEDIA });
  }

  async function keysInBucket() {
    return (await env.MEDIA.list()).objects.map((o) => o.key).sort();
  }

  it("deletes an object no row points at, and keeps the one a link uses", async () => {
    const db = await seedLink();
    await db
      .update(schema.links)
      .set({ qrLogo: "/api/orgs/org-1/qr-logo/kept.webp" })
      .where(eq(schema.links.id, sampleLink.id));
    await putLogo("org-1/kept.webp");
    await putLogo("org-1/abandoned.webp");

    expect(await sweepOrphanQrLogos(agedEnv())).toBe(1);
    expect(await keysInBucket()).toEqual(["org-1/kept.webp"]);
  });

  it("keeps a logo an org's QR defaults point at, not only a link's", async () => {
    await seedLink();
    await env.DB.prepare("update orgs set qr_logo = ? where id = 'org-1'")
      .bind("/api/orgs/org-1/qr-logo/default.webp")
      .run();
    await putLogo("org-1/default.webp");
    await putLogo("org-1/stray.webp");

    expect(await sweepOrphanQrLogos(agedEnv())).toBe(1);
    expect(await keysInBucket()).toEqual(["org-1/default.webp"]);
  });

  it("leaves a fresh upload alone, since its row may still be coming", async () => {
    await seedLink();
    await putLogo("org-1/just-uploaded.webp");

    // The real env, so `uploaded` is now: inside the grace period.
    expect(await sweepOrphanQrLogos(testEnv)).toBe(0);
    expect(await keysInBucket()).toEqual(["org-1/just-uploaded.webp"]);
  });

  it("is safe to run twice", async () => {
    await seedLink();
    await putLogo("org-1/abandoned.webp");

    expect(await sweepOrphanQrLogos(agedEnv())).toBe(1);
    expect(await sweepOrphanQrLogos(agedEnv())).toBe(0);
    expect(await keysInBucket()).toEqual([]);
  });
});
