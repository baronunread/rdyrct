import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
} from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
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
} from "../../src/worker/storage";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };

function overrideEnv(overrides: Partial<Env>): Env {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property in overrides) return overrides[property as keyof Env];
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as Env;
}

// A queue that records what was sent, so producer paths can be asserted without
// a live queue delivering messages back into the worker under test.
function captureQueue(): { queue: Queue<StorageMessage>; sent: StorageMessage[] } {
  const sent: StorageMessage[] = [];
  const queue = {
    async send(message: StorageMessage) {
      sent.push(message);
    },
    async sendBatch(messages: Iterable<{ body: StorageMessage }>) {
      for (const m of messages) sent.push(m.body);
    },
  } as unknown as Queue<StorageMessage>;
  return { queue, sent };
}

function failingKv(): KVNamespace {
  return new Proxy(env.LINKS, {
    get(target, property, receiver) {
      if (property === "put" || property === "delete") {
        return async () => {
          throw new Error("injected KV failure");
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function failingR2(): R2Bucket {
  return new Proxy(env.QR_LOGOS, {
    get(target, property, receiver) {
      if (property === "delete") {
        return async () => {
          throw new Error("injected R2 failure");
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Builds a real MessageBatch via the official cloudflare:test helpers, so ack/
// retry/dead-letter assertions exercise the same runtime semantics production
// queue delivery does, rather than hand-rolled spies.
function batchOf(queueName: string, bodies: StorageMessage[], attempts = 1) {
  const batch = createMessageBatch(
    queueName,
    bodies.map((body, i) => ({ id: `m${i}`, timestamp: new Date(), attempts, body })),
  );
  const ctx = createExecutionContext();
  return { batch, ctx };
}

const sampleLink = {
  id: "link-1",
  orgId: "org-1",
  slug: "sale",
  destination: "https://example.com",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
};

async function seedLink(destination = "https://example.com") {
  const db = drizzle(env.DB, { schema });
  await db.batch([
    db.insert(schema.orgs).values({ id: "org-1", name: "Test", createdAt: 0 }),
    db.insert(schema.links).values({ ...sampleLink, destination, createdAt: 0 }),
  ]);
  return db;
}

beforeEach(async () => {
  await reset();
  const testEnv = env as TestEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("storage queue: kv_sync", () => {
  it("publishes a link's key from D1 and is safe to run twice", async () => {
    const db = await seedLink();
    const message = syncLinkMsg(sampleLink.slug, null);

    await applyStorageMessage(env as Env, db, message);
    await applyStorageMessage(env as Env, db, message);

    expect(await env.LINKS.get("slug:sale", "json")).toMatchObject({
      linkId: "link-1",
      url: "https://example.com/",
    });
  });

  it("deletes the key when the row is gone, whatever order messages ran in", async () => {
    const db = await seedLink();
    const message = syncLinkMsg(sampleLink.slug, null);
    // Publish once so KV holds a value.
    await applyStorageMessage(env as Env, db, message);
    expect(await env.LINKS.get("slug:sale")).not.toBeNull();

    // Now delete the row and replay the SAME message. Because the consumer
    // reads current D1 truth, a stale "publish-era" message still lands on a
    // delete: no older message can revive a removed link.
    await db.delete(schema.links).where(eq(schema.links.id, "link-1"));
    await applyStorageMessage(env as Env, db, message);

    expect(await env.LINKS.get("slug:sale")).toBeNull();
  });

  it("reflects the latest destination no matter which sync runs last", async () => {
    const db = await seedLink("https://old.example.com");
    const message = syncLinkMsg(sampleLink.slug, null);
    await applyStorageMessage(env as Env, db, message);

    await db
      .update(schema.links)
      .set({ destination: "https://new.example.com" })
      .where(eq(schema.links.id, "link-1"));
    // Two identical messages, run after the update: both converge on the new value.
    await applyStorageMessage(env as Env, db, message);
    await applyStorageMessage(env as Env, db, message);

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
    await consumeStorageBatch(env as Env, retry.batch);
    const succeeded = await getQueueResult(retry.batch, retry.ctx);
    expect(succeeded.explicitAcks).toHaveLength(1);
    expect(await env.LINKS.get("slug:sale")).not.toBeNull();
    void db;
  });

  it("retries an R2 delete under outage, then applies it", async () => {
    await env.QR_LOGOS.put("org-1/logo.webp", "logo");
    const message = deleteQrLogoMsg("/api/orgs/org-1/qr-logo/logo.webp")!;

    const down = batchOf("rdyrct-storage", [message]);
    await consumeStorageBatch(overrideEnv({ QR_LOGOS: failingR2() }), down.batch);
    const failed = await getQueueResult(down.batch, down.ctx);
    expect(failed.retryMessages).toHaveLength(1);
    expect(await env.QR_LOGOS.head("org-1/logo.webp")).not.toBeNull();

    const up = batchOf("rdyrct-storage", [message]);
    await consumeStorageBatch(env as Env, up.batch);
    const succeeded = await getQueueResult(up.batch, up.ctx);
    expect(succeeded.explicitAcks).toHaveLength(1);
    expect(await env.QR_LOGOS.head("org-1/logo.webp")).toBeNull();
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

  it("logs and acks every message once it reaches the dead-letter queue", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { batch, ctx } = batchOf("rdyrct-storage-dlq", [
      syncLinkMsg("sale", null),
      deleteQrLogoMsg("/api/orgs/org-1/qr-logo/logo.webp")!,
    ]);

    await logDeadLetterBatch(env as Env, batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toHaveLength(2);
    expect(result.retryMessages).toEqual([]);
    const logged = errors.mock.calls.map(([a]) => String(a));
    expect(logged.some((line) => line.includes("storage_message_gave_up"))).toBe(true);
    expect(logged.some((line) => line.includes("slug:sale"))).toBe(true);
    errors.mockRestore();
  });

  it("alerts Better Stack with the same events once it reaches the dead-letter queue", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const { batch, ctx } = batchOf("rdyrct-storage-dlq", [syncLinkMsg("sale", null)]);
    const alerting = overrideEnv({
      BETTERSTACK_SOURCE_TOKEN: "tok_test",
      BETTERSTACK_INGEST_URL: "https://in.logs.betterstack.example",
    });

    await logDeadLetterBatch(alerting, batch);
    await getQueueResult(batch, ctx);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://in.logs.betterstack.example",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer tok_test" }),
      }),
    );
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body).toEqual([
      { event: "storage_message_gave_up", op: "kv_sync", target: "slug:sale" },
    ]);
    fetchSpy.mockRestore();
  });

  it("does not alert when Better Stack is unconfigured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { batch, ctx } = batchOf("rdyrct-storage-dlq", [syncLinkMsg("sale", null)]);
    const unconfigured = overrideEnv({
      BETTERSTACK_SOURCE_TOKEN: undefined,
      BETTERSTACK_INGEST_URL: undefined,
    });

    await logDeadLetterBatch(unconfigured, batch);
    await getQueueResult(batch, ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("org teardown steps under secondary-store outage", () => {
  it("removes the org from D1 and keeps cleanup durable across an outage", async () => {
    const db = await seedLink();
    await env.LINKS.put("slug:sale", "stale");
    await env.QR_LOGOS.put("org-1/logo.webp", "logo");

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
    await expect(deleteR2Prefix(overrideEnv({ QR_LOGOS: failingR2() }), "org-1/")).rejects.toThrow(
      "injected R2 failure",
    );
    expect(await env.LINKS.get("slug:sale")).not.toBeNull();
    expect(await env.QR_LOGOS.head("org-1/logo.webp")).not.toBeNull();

    // Once the stores recover the steps complete and are idempotent.
    await deleteKvKeys(env as Env, gathered.kvKeys);
    await deleteR2Prefix(env as Env, "org-1/");
    expect(await env.LINKS.get("slug:sale")).toBeNull();
    expect(await env.QR_LOGOS.head("org-1/logo.webp")).toBeNull();
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
    const queue = {
      async send() {
        throw new Error("injected queue-send failure");
      },
      async sendBatch() {
        throw new Error("injected queue-send failure");
      },
    } as unknown as Queue<StorageMessage>;

    await expect(
      enqueueStorage(overrideEnv({ STORAGE_QUEUE: queue }), [syncLinkMsg("sale", null)]),
    ).rejects.toThrow("injected queue-send failure");
  });
});
