/**
 * The repair path for storage work D1 committed and the queue did not (#118).
 * Both holes open after the mutation is durable, so neither can fail the request.
 * Messages name a key, never a value: anything added to StorageMessage must keep that true.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getQueueResult, reset } from "cloudflare:test";
import {
  OUTBOX_RETRY_BACKOFF,
  drainStorageOutbox,
  enqueueStorage,
  logDeadLetterBatch,
  syncLinkMsg,
  type StorageMessage,
} from "../../src/worker/storage";
import {
  applyTestMigrations,
  batchOf,
  overrideEnv,
  overriding,
  sampleLink,
  seedLink,
  stubQueue,
  testEnv,
} from "./support";

afterEach(reset);
beforeEach(applyTestMigrations);

const brokenKv = () =>
  overriding(env.LINKS, {
    put: async () => {
      throw new Error("kv unavailable");
    },
    delete: async () => {
      throw new Error("kv unavailable");
    },
  });

const brokenQueue = () =>
  stubQueue<StorageMessage>(() => {
    throw new Error("queue unavailable");
  });

async function outboxRows() {
  const rows = await env.DB.prepare(
    "select op, target, reason, attempts from storage_outbox order by target",
  ).all<{ op: string; target: string; reason: string; attempts: number }>();
  return rows.results;
}

const kvValue = (key: string) => env.LINKS.get(key);

const queueOutbox = (id: string, target: string, op = "kv_sync") =>
  env.DB.prepare(
    "insert into storage_outbox (id, op, target, reason, created_at) values (?, ?, ?, 'gave_up', 0)",
  )
    .bind(id, op, target)
    .run();

function unavailableKv(): typeof env.LINKS {
  const fail = async (): Promise<never> => {
    throw new Error("kv unavailable");
  };
  // SAFETY: the drain only ever reaches get/put/delete on this binding, and
  // all three are present; a test that starts using another member gets a
  // TypeError naming it rather than a silent pass.
  return {
    get: fail,
    put: fail,
    delete: fail,
    list: fail,
    getWithMetadata: fail,
  } as typeof env.LINKS;
}

describe("the idempotency contract", () => {
  it("carries the key to look up, never the value to write", async () => {
    // Everything else here depends on this: a message carrying a destination
    // would replay a stale one, and no other test would notice.
    const message = syncLinkMsg("abc", null);
    expect(message).toEqual({ op: "kv_sync", key: "slug:abc" });
    expect(Object.keys(message).sort()).toEqual(["key", "op"]);
  });

  it("lands on current D1 state, not on the state at send time", async () => {
    await seedLink("https://example.com/first");
    const key = `slug:${sampleLink.slug}`;

    await env.DB.prepare("update links set destination = ? where id = ?")
      .bind("https://example.com/second", sampleLink.id)
      .run();

    await queueOutbox("o1", key);
    expect(await drainStorageOutbox(testEnv)).toBe(1);

    expect(await kvValue(key)).toContain("example.com/second");
  });

  it("is safe to apply twice", async () => {
    await seedLink();
    const key = `slug:${sampleLink.slug}`;

    await queueOutbox("o1", key);
    await drainStorageOutbox(testEnv);
    const first = await kvValue(key);

    await queueOutbox("o2", key);
    await drainStorageOutbox(testEnv);

    expect(first).not.toBeNull();
    expect(await kvValue(key)).toEqual(first);
  });
});

describe("a send the queue refuses", () => {
  it("records the work and returns, because the mutation already committed", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue(), LINKS: brokenKv() });

    // No throw: the row below is the durable record the drain replays from,
    // so a 500 to the caller would be a lie (#227).
    await expect(enqueueStorage(failing, [syncLinkMsg("abc", null)])).resolves.toBeUndefined();

    expect(await outboxRows()).toEqual([
      { op: "kv_sync", target: "slug:abc", reason: "send_failed", attempts: 0 },
    ]);
  });

  it("rethrows when the outbox write fails too, because then the work is gone", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue(), LINKS: brokenKv() });
    // With the record gone too, nothing remembers the work, so the caller has to hear.
    await env.DB.exec("drop table storage_outbox");

    await expect(enqueueStorage(failing, [syncLinkMsg("abc", null)])).rejects.toThrow(
      "queue unavailable",
    );
  });

  it("keeps one row per target however many times it fails", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue(), LINKS: brokenKv() });
    for (let i = 0; i < 3; i++) await enqueueStorage(failing, [syncLinkMsg("abc", null)]);

    // Re-applying desired state is a no-op, so a repeat failure replaces the
    // row rather than queueing the same drain three times.
    expect(await outboxRows()).toHaveLength(1);
  });

  it("writes nothing when there was nothing to send", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue(), LINKS: brokenKv() });
    await enqueueStorage(failing, [null]);
    expect(await outboxRows()).toEqual([]);
  });
});

describe("a message that exhausted every delivery", () => {
  it("goes to the outbox instead of being alerted on and dropped", async () => {
    const { batch } = batchOf("rdyrct-storage-dlq", [syncLinkMsg("gone", null)]);

    await logDeadLetterBatch(testEnv, batch);

    expect(await outboxRows()).toEqual([
      { op: "kv_sync", target: "slug:gone", reason: "gave_up", attempts: 0 },
    ]);
  });
});

describe("a dead-letter batch whose outbox row cannot be written", () => {
  it("retries instead of acknowledging, because the row is the only record left", async () => {
    await env.DB.exec("drop table storage_outbox");
    const { batch, ctx } = batchOf("rdyrct-storage-dlq", [syncLinkMsg("gone", null)]);

    await logDeadLetterBatch(testEnv, batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.retryBatch.retry).toBe(true);
    expect(result.explicitAcks).toEqual([]);
  });
});

describe("the daily drain", () => {
  it("uses the indexed retry order instead of sorting the outbox", async () => {
    const plan = await env.DB.prepare(
      `explain query plan
       select * from storage_outbox
       order by created_at + attempts * ${OUTBOX_RETRY_BACKOFF}
       limit 200`,
    ).all<{ detail: string }>();

    expect(plan.results.some((row) => row.detail.includes("idx_storage_outbox_drain"))).toBe(true);
  });

  it("clears what it applied and keeps what it could not", async () => {
    await seedLink();
    await env.DB.batch([
      env.DB.prepare(
        "insert into storage_outbox (id, op, target, reason, created_at) values ('good', 'kv_sync', ?, 'gave_up', 1)",
      ).bind(`slug:${sampleLink.slug}`),
      env.DB.prepare(
        "insert into storage_outbox (id, op, target, reason, created_at) values ('prefix', 'r2_delete_prefix', 'nobody/', 'gave_up', 2)",
      ),
    ]);

    expect(await drainStorageOutbox(testEnv)).toBe(2);
    expect(await outboxRows()).toEqual([]);
  });

  it("counts an attempt and leaves the row when applying throws", async () => {
    await env.DB.prepare(
      "insert into storage_outbox (id, op, target, reason, created_at) values ('bad', 'kv_sync', 'slug:whatever', 'gave_up', 0)",
    ).run();
    // Every call throws, deliberately: a KV binding keeps its methods on the
    // prototype, so spreading it drops them and Object.create hands the
    // native method the wrong `this`.
    const broken = overrideEnv({ LINKS: unavailableKv() });

    expect(await drainStorageOutbox(broken)).toBe(0);
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(1);
  });

  // 201 rows is 201 sequential KV round trips, past the 5s default on a loaded CI runner.
  it("drains a fresh row even when the limit is full of rows that keep failing", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    // The limit is 200. Ordering by age alone selected the 200 older stuck rows
    // every pass, so this one never drained. Timestamps use the daily cron's
    // real scale: an hourly attempt weight still keeps the old rows ahead.
    await seedLink();
    const stuck = Array.from({ length: 200 }, (_, i) =>
      env.DB.prepare(
        "insert into storage_outbox (id, op, target, reason, created_at, attempts) values (?, 'kv_sync', ?, 'gave_up', ?, 5)",
      ).bind(`stuck-${i}`, `slug:stuck-${i}`, i),
    );
    // Chunked: D1 caps how much one batch may carry.
    for (let i = 0; i < stuck.length; i += 50) await env.DB.batch(stuck.slice(i, i + 50));
    await queueOutbox("fresh", `slug:${sampleLink.slug}`);
    await env.DB.prepare("update storage_outbox set created_at = ? where id = 'fresh'")
      .bind(4 * DAY)
      .run();

    await drainStorageOutbox(testEnv);

    const left = await env.DB.prepare(
      "select count(*) as n from storage_outbox where id = 'fresh'",
    ).first<{ n: number }>();
    expect(left!.n).toBe(0);
  }, 15_000);

  it("drains a retry row even under a steady stream of new work", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    // The reason the ordering is a backoff, not a priority: ranking by attempts
    // alone lets 200 fresh rows a day keep a once-failed row out of every pass.
    await seedLink();
    await env.DB.prepare(
      "insert into storage_outbox (id, op, target, reason, created_at, attempts) values ('retry', 'kv_sync', ?, 'gave_up', 0, 1)",
    )
      .bind(`slug:${sampleLink.slug}`)
      .run();
    const fresh = Array.from({ length: 200 }, (_, i) =>
      env.DB.prepare(
        "insert into storage_outbox (id, op, target, reason, created_at, attempts) values (?, 'kv_sync', ?, 'gave_up', ?, 0)",
      ).bind(`fresh-${i}`, `slug:fresh-${i}`, 2 * DAY + i),
    );
    for (let i = 0; i < fresh.length; i += 50) await env.DB.batch(fresh.slice(i, i + 50));

    await drainStorageOutbox(testEnv);

    const left = await env.DB.prepare(
      "select count(*) as n from storage_outbox where id = 'retry'",
    ).first<{ n: number }>();
    expect(left!.n).toBe(0);
  }, 15_000);

  it("gives every re-record a new id, so a drain cannot delete a newer request", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue(), LINKS: brokenKv() });
    await enqueueStorage(failing, [syncLinkMsg("abc", null)]);
    const first = await env.DB.prepare("select id from storage_outbox").first<{ id: string }>();

    await enqueueStorage(failing, [syncLinkMsg("abc", null)]);
    const second = await env.DB.prepare("select id from storage_outbox").first<{ id: string }>();

    // The drain deletes by id, so a row being applied must stop matching.
    // `last_error` could not do that: equal messages are indistinguishable.
    expect(second!.id).not.toBe(first!.id);
  });

  it("does nothing when the outbox is empty", async () => {
    expect(await drainStorageOutbox(testEnv)).toBe(0);
  });

  it("skips a row whose backed-off retry is not due yet", async () => {
    await seedLink();
    // One failed attempt backs it off a full day (OUTBOX_RETRY_BACKOFF). With
    // the outbox this small it would otherwise be retried on every drain.
    await env.DB.prepare(
      "insert into storage_outbox (id, op, target, reason, created_at, attempts) values ('not-due', 'kv_sync', ?, 'gave_up', ?, 1)",
    )
      .bind(`slug:${sampleLink.slug}`, Date.now())
      .run();

    expect(await drainStorageOutbox(testEnv)).toBe(0);
    expect(await outboxRows()).toEqual([
      { op: "kv_sync", target: `slug:${sampleLink.slug}`, reason: "gave_up", attempts: 1 },
    ]);
  });
});
