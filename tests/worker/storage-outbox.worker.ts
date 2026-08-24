/**
 * The repair path for storage work D1 committed and the queue did not (#118).
 *
 * Both holes open after the mutation is already durable, so neither can be
 * answered by failing the request: a `sendBatch` that fails leaves KV serving
 * the old value with nothing scheduled to fix it, and a message that exhausts
 * every delivery used to be alerted on and dropped with only its op and target
 * in the alert, so the change could not be replayed even by hand.
 *
 * The first describe pins the idempotency contract the rest of it rests on.
 * A message names a key, never a value, so applying it twice or long after the
 * fact still lands on current D1 state. Anything added to StorageMessage has
 * to keep that true.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getQueueResult, reset } from "cloudflare:test";
import {
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
  sampleLink,
  seedLink,
  stubQueue,
  testEnv,
} from "./support";

afterEach(reset);
beforeEach(applyTestMigrations);

/** A STORAGE_QUEUE whose sendBatch always fails, which is the hole. */
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

/** A row standing for work the queue never applied. */
const queueOutbox = (id: string, target: string, op = "kv_sync") =>
  env.DB.prepare(
    "insert into storage_outbox (id, op, target, reason, created_at) values (?, ?, ?, 'gave_up', 0)",
  )
    .bind(id, op, target)
    .run();

/** A KV binding whose every call fails, standing in for KV being unavailable
 * when the drain runs. Not a partial stub: see the note at its call site. */
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
    // Written as an assertion rather than a comment because everything else
    // here depends on it: a message that carried a destination would replay a
    // stale one, and no other test would notice.
    const message = syncLinkMsg("abc", null);
    expect(message).toEqual({ op: "kv_sync", key: "slug:abc" });
    expect(Object.keys(message).sort()).toEqual(["key", "op"]);
  });

  it("lands on current D1 state, not on the state at send time", async () => {
    await seedLink("https://example.com/first");
    const key = `slug:${sampleLink.slug}`;

    // The destination changes after the message would have been sent, which
    // is exactly the case a payload-carrying message would get wrong.
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
  it("records the work and still reports the failure to the caller", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue() });

    await expect(enqueueStorage(failing, [syncLinkMsg("abc", null)])).rejects.toThrow(
      "queue unavailable",
    );

    // The caller still hears about it: the mutation is committed either way,
    // and swallowing this would hide a queue outage completely.
    expect(await outboxRows()).toEqual([
      { op: "kv_sync", target: "slug:abc", reason: "send_failed", attempts: 0 },
    ]);
  });

  it("keeps one row per target however many times it fails", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue() });
    for (let i = 0; i < 3; i++)
      await enqueueStorage(failing, [syncLinkMsg("abc", null)]).catch(() => {});

    // Re-applying desired state is a no-op, so a repeat failure replaces the
    // row rather than queueing the same drain three times.
    expect(await outboxRows()).toHaveLength(1);
  });

  it("writes nothing when there was nothing to send", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue() });
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
    // Dropping the table is the cheapest way to make the write fail the way a
    // transient D1 error would.
    await env.DB.exec("drop table storage_outbox");
    const { batch, ctx } = batchOf("rdyrct-storage-dlq", [syncLinkMsg("gone", null)]);

    await logDeadLetterBatch(testEnv, batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.retryBatch.retry).toBe(true);
    expect(result.explicitAcks).toEqual([]);
  });
});

describe("the daily drain", () => {
  it("clears what it applied and keeps what it could not", async () => {
    await seedLink();
    await env.DB.batch([
      env.DB.prepare(
        "insert into storage_outbox (id, op, target, reason, created_at) values ('good', 'kv_sync', ?, 'gave_up', 1)",
      ).bind(`slug:${sampleLink.slug}`),
      // A prefix delete against an R2 binding that works, so both rows apply:
      // the point of the pair is that the drain clears rows one at a time.
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
    // A KV binding that refuses, standing in for the storage layer still
    // being unavailable when the drain runs.
    // Every call throws, deliberately. A selective stub is not available: a
    // KV binding keeps its methods on the prototype, so spreading it drops
    // them all, and delegating through Object.create hands the native method
    // the wrong `this`. Since this test only asks what happens when the apply
    // fails, "KV is down" is the honest stand-in.
    const broken = overrideEnv({ LINKS: unavailableKv() });

    expect(await drainStorageOutbox(broken)).toBe(0);
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    // Counted, so a row that can never apply is findable rather than retried
    // forever in silence.
    expect(rows[0].attempts).toBe(1);
  });

  it("drains a fresh row even when the limit is full of rows that keep failing", async () => {
    // The limit is 200. With 200 stuck rows older than this one, ordering by
    // age alone selected exactly those every pass and the recovery recorded
    // afterwards never drained at all.
    await seedLink();
    const stuck = Array.from({ length: 200 }, (_, i) =>
      env.DB.prepare(
        "insert into storage_outbox (id, op, target, reason, created_at, attempts) values (?, 'kv_sync', ?, 'gave_up', ?, 5)",
      ).bind(`stuck-${i}`, `slug:stuck-${i}`, i),
    );
    // Chunked: D1 caps how much one batch may carry.
    for (let i = 0; i < stuck.length; i += 50) await env.DB.batch(stuck.slice(i, i + 50));
    await queueOutbox("fresh", `slug:${sampleLink.slug}`);
    await env.DB.prepare("update storage_outbox set created_at = 9999 where id = 'fresh'").run();

    await drainStorageOutbox(testEnv);

    const left = await env.DB.prepare(
      "select count(*) as n from storage_outbox where id = 'fresh'",
    ).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it("gives every re-record a new id, so a drain cannot delete a newer request", async () => {
    const failing = overrideEnv({ STORAGE_QUEUE: brokenQueue() });
    await enqueueStorage(failing, [syncLinkMsg("abc", null)]).catch(() => {});
    const first = await env.DB.prepare("select id from storage_outbox").first<{ id: string }>();

    await enqueueStorage(failing, [syncLinkMsg("abc", null)]).catch(() => {});
    const second = await env.DB.prepare("select id from storage_outbox").first<{ id: string }>();

    // The drain deletes by id after applying, so a request that arrives while
    // its row is being applied has to stop matching. `last_error` could not do
    // that: two failures with the same message are indistinguishable.
    expect(second!.id).not.toBe(first!.id);
  });

  it("does nothing when the outbox is empty", async () => {
    expect(await drainStorageOutbox(testEnv)).toBe(0);
  });
});
