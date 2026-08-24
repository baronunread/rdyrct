import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { env } from "cloudflare:workers";
import { getQueueResult, reset } from "cloudflare:test";
import {
  consumeClickBatch,
  isDeletedLink,
  logClickDeadLetterBatch,
  sweepDedupeIds,
  type ClickMessage,
} from "../../src/worker/clicks";
import {
  applyTestMigrations,
  batchOf,
  sampleAddress,
  sampleLink,
  seedLink,
  testEnv,
  overrideEnv,
} from "./support";

function clickMessage(overrides: Partial<ClickMessage> = {}): ClickMessage {
  return {
    dedupeId: crypto.randomUUID(),
    linkId: sampleLink.id,
    addressId: sampleAddress.id,
    orgId: sampleLink.orgId,
    ts: 0,
    country: "US",
    referrer: "",
    device: "desktop",
    ...overrides,
  };
}

async function clickCount(): Promise<number> {
  return (
    (await env.DB.prepare("select count(*) as count from clicks").first<{ count: number }>())
      ?.count ?? 0
  );
}

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});

/** A D1 binding whose every call fails, standing in for the database being
 * unavailable. The distinction the salvage draws is "deleted link" against
 * "everything else", and a deleted link is the only per-row failure a test
 * can produce for real, so the other side needs the whole binding. */
function unavailableD1(): typeof env.DB {
  // One rejected promise, marked handled once and handed out to every call.
  // A fresh rejection per call leaks: drizzle's batch creates per-statement
  // promises it abandons as soon as the batch itself fails, and each of those
  // surfaces as an unhandled rejection that fails the run with every test
  // green. Awaiting this still throws exactly as before.
  const failure: Promise<never> = Promise.reject(new Error("D1_ERROR: network"));
  failure.catch(() => {});
  const reject = (): Promise<never> => failure;
  // A statement that binds fine and fails when it runs, which is what a real
  // binding does when the database is unreachable. Throwing from `prepare`
  // instead leaves drizzle holding query objects it never awaits, and those
  // surface as unhandled rejections that fail the run with every test green.
  // SAFETY: consumeClickBatch's drizzle queries reach only bind and the four
  // result methods; anything else raises a TypeError naming the member rather
  // than passing silently.
  const statement = {
    bind: () => statement,
    run: reject,
    all: reject,
    first: reject,
    raw: reject,
  } as D1PreparedStatement;
  // SAFETY: consumeClickBatch reaches only prepare and batch on this binding,
  // and both are present; anything else raises a TypeError naming the member
  // rather than passing silently.
  const session = {
    prepare: () => statement,
    batch: reject,
    getBookmark: () => null,
  };
  // SAFETY: consumeClickBatch reaches only prepare and batch on this binding,
  // and both are present; anything else raises a TypeError naming the member.
  return {
    prepare: () => statement,
    batch: reject,
    exec: reject,
    dump: reject,
    withSession: () => session,
  } as typeof env.DB;
}

/** Did the salvage report dropping clicks it could never write? */
const loggedDrop = (errors: { mock: { calls: unknown[][] } }): boolean =>
  errors.mock.calls.some(([a]) => String(a).includes("click_dropped_unwritable"));

describe("click queue: consumer", () => {
  it("batches every message in the batch into one insert", async () => {
    await seedLink();
    const { batch, ctx } = batchOf("rdyrct-clicks", [
      clickMessage({ dedupeId: "a" }),
      clickMessage({ dedupeId: "b" }),
      clickMessage({ dedupeId: "c" }),
    ]);

    await consumeClickBatch(testEnv, batch);

    expect(await clickCount()).toBe(3);
    const result = await getQueueResult(batch, ctx);
    expect(result.ackAll).toBe(true);
  });

  it("attributes each inserted click to its address, not just its link (#38)", async () => {
    await seedLink();
    const { batch } = batchOf("rdyrct-clicks", [clickMessage()]);

    await consumeClickBatch(testEnv, batch);

    const row = await env.DB.prepare("select address_id from clicks limit 1").first<{
      address_id: string | null;
    }>();
    expect(row?.address_id).toBe(sampleAddress.id);
  });

  it("persists a full-size batch that would exceed D1's bound-parameter limit as one insert", async () => {
    await seedLink();
    // A click row binds 7 values, so a naive single-statement insert of a
    // full 100-message batch would bind 700 parameters and exceed D1's cap
    // of 100. The consumer must chunk this internally and still land every
    // row from one batch.
    const messages = Array.from({ length: 100 }, (_, i) => clickMessage({ dedupeId: `bulk-${i}` }));
    const { batch, ctx } = batchOf("rdyrct-clicks", messages);

    await consumeClickBatch(testEnv, batch);

    expect(await clickCount()).toBe(100);
    const result = await getQueueResult(batch, ctx);
    expect(result.ackAll).toBe(true);
  });

  it("dedupes a redelivered message instead of double-inserting", async () => {
    await seedLink();
    const message = clickMessage({ dedupeId: "dup-1" });

    await consumeClickBatch(testEnv, batchOf("rdyrct-clicks", [message]).batch);
    expect(await clickCount()).toBe(1);

    // A redelivery of the exact same message (same dedupeId) must not add a
    // second row.
    await consumeClickBatch(testEnv, batchOf("rdyrct-clicks", [message]).batch);
    expect(await clickCount()).toBe(1);
  });

  it("retries the whole batch when the insert fails, then succeeds once it recovers", async () => {
    await seedLink();
    // A message for a link that does not exist violates the FK and fails the
    // whole batch's insert.
    const { batch, ctx } = batchOf("rdyrct-clicks", [
      clickMessage({ dedupeId: "ok" }),
      clickMessage({ dedupeId: "bad", linkId: "no-such-link" }),
    ]);

    await consumeClickBatch(testEnv, batch);
    const failed = await getQueueResult(batch, ctx);
    expect(failed.retryBatch.retry).toBe(true);
    expect(await clickCount()).toBe(0);

    // Once the bad message is gone (dead-lettered after exhausting retries,
    // in production), a redelivery of the surviving message succeeds.
    const retry = batchOf("rdyrct-clicks", [clickMessage({ dedupeId: "ok" })]);
    await consumeClickBatch(testEnv, retry.batch);
    const succeeded = await getQueueResult(retry.batch, retry.ctx);
    expect(succeeded.ackAll).toBe(true);
    expect(await clickCount()).toBe(1);
  });

  it("stores every good click in a batch when one link was deleted, on the last delivery", async () => {
    await seedLink();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // Nine ordinary clicks and one for a link that is gone, on the delivery
    // that would otherwise dead-letter all ten (#102).
    const good = Array.from({ length: 9 }, (_, i) => clickMessage({ dedupeId: `ok-${i}` }));
    const { batch, ctx } = batchOf(
      "rdyrct-clicks",
      [...good, clickMessage({ dedupeId: "bad", linkId: "no-such-link" })],
      6,
    );

    await consumeClickBatch(testEnv, batch);

    const result = await getQueueResult(batch, ctx);
    // Acked one at a time now, not ackAll: see the mixed-attempts test above.
    expect(result.explicitAcks).toHaveLength(10);
    expect(result.retryMessages).toEqual([]);
    expect(await clickCount()).toBe(9);
    expect(loggedDrop(errors)).toBe(true);
    errors.mockRestore();
  });

  it("does not count an exhausted transient failure as an unwritable click", async () => {
    await seedLink();
    await env.DB.prepare(
      `create trigger fail_one_click before insert on clicks
       when new.dedupe_id = 'transient'
       begin select raise(abort, 'D1_ERROR: busy'); end`,
    ).run();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { batch, ctx } = batchOf(
      "rdyrct-clicks",
      [clickMessage({ dedupeId: "stored" }), clickMessage({ dedupeId: "transient" })],
      6,
    );

    await consumeClickBatch(testEnv, batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks.sort()).toEqual(["m0", "m1"]);
    expect(await clickCount()).toBe(1);
    expect(loggedDrop(errors)).toBe(false);
    errors.mockRestore();
  });

  it("acks a click for a deleted link at once, however many deliveries it has left", async () => {
    await seedLink();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // Cloudflare re-batches a redelivered message alongside fresh ones, so a
    // batch containing one exhausted message says nothing about the rest.
    // Both bad messages here name a link that is gone, which no number of
    // redeliveries will bring back: acking now saves five deliveries that
    // would reach the same answer, and the good one is unaffected.
    const { batch, ctx } = batchOf(
      "rdyrct-clicks",
      [
        clickMessage({ dedupeId: "old-bad", linkId: "no-such-link" }),
        clickMessage({ dedupeId: "young-bad", linkId: "no-such-link" }),
        clickMessage({ dedupeId: "good" }),
      ],
      [6, 1, 1],
    );

    await consumeClickBatch(testEnv, batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks.sort()).toEqual(["m0", "m1", "m2"]);
    expect(result.retryMessages).toEqual([]);
    expect(await clickCount()).toBe(1);
    errors.mockRestore();
  });

  it("does not double-count a salvaged click that already landed", async () => {
    await seedLink();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const shared = clickMessage({ dedupeId: "shared" });
    await consumeClickBatch(testEnv, batchOf("rdyrct-clicks", [shared]).batch);
    expect(await clickCount()).toBe(1);

    // The same message rides a later batch that has to be salvaged. Dedupe
    // has to survive the split, or a bad neighbour turns into a double count.
    const { batch } = batchOf(
      "rdyrct-clicks",
      [shared, clickMessage({ dedupeId: "bad", linkId: "no-such-link" })],
      6,
    );
    await consumeClickBatch(testEnv, batch);

    expect(await clickCount()).toBe(1);
    errors.mockRestore();
  });

  it("retries the whole batch when the database is what failed", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // Acking here would report clicks as stored that D1 never saw, and
    // counting them as dropped would report an outage as permanent loss.
    const { batch, ctx } = batchOf("rdyrct-clicks", [clickMessage({ dedupeId: "a" })], 6);

    await consumeClickBatch(overrideEnv({ DB: unavailableD1() }), batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.retryBatch.retry).toBe(true);
    expect(errors.mock.calls.some(([a]) => String(a).includes("click_batch_dead_letter"))).toBe(
      true,
    );
    expect(loggedDrop(errors)).toBe(false);
    errors.mockRestore();
  });

  it("acks and counts a batch that is entirely clicks for deleted links", async () => {
    await seedLink();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // Nothing stored, but nothing was the database's fault either: one busy
    // link was deleted and every click in this batch was for it. Reading that
    // as an outage dead-lettered clicks that should have been acked and
    // counted.
    const { batch, ctx } = batchOf(
      "rdyrct-clicks",
      [
        clickMessage({ dedupeId: "a", linkId: "no-such-link" }),
        clickMessage({ dedupeId: "b", linkId: "no-such-link" }),
      ],
      6,
    );

    await consumeClickBatch(testEnv, batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks.sort()).toEqual(["m0", "m1"]);
    expect(result.retryMessages).toEqual([]);
    expect(loggedDrop(errors)).toBe(true);
    errors.mockRestore();
  });

  it("logs click_batch_dead_letter only once a message reaches its last delivery", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const loggedDeadLetter = () =>
      errors.mock.calls.some(([a]) => String(a).includes("click_batch_dead_letter"));
    const failing = overrideEnv({ DB: unavailableD1() });

    const early = batchOf("rdyrct-clicks", [clickMessage()], 1);
    await consumeClickBatch(failing, early.batch);
    expect(loggedDeadLetter()).toBe(false);

    const last = batchOf("rdyrct-clicks", [clickMessage()], 6);
    await consumeClickBatch(failing, last.batch);
    expect(loggedDeadLetter()).toBe(true);
    errors.mockRestore();
  });
});

describe("click queue: dead-letter visibility", () => {
  it("acks and captures a Sentry alert for every message once it reaches the dead-letter queue", async () => {
    const captureSpy = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");
    const { batch, ctx } = batchOf("rdyrct-clicks-dlq", [clickMessage()]);

    await logClickDeadLetterBatch(batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.ackAll).toBe(true);
    expect(captureSpy).toHaveBeenCalledWith("click_dropped", {
      level: "error",
      extra: { linkId: sampleLink.id, orgId: sampleLink.orgId },
    });
    captureSpy.mockRestore();
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sweepDedupeIds (#70)", () => {
  /** One click row, straight into D1, at the age the test cares about. */
  async function seedClick(id: number, ageDays: number, dedupeId: string | null) {
    await env.DB.prepare(
      "insert into clicks (id, link_id, org_id, ts, country, referrer, device, dedupe_id) values (?, ?, ?, ?, '', '', '', ?)",
    )
      .bind(id, sampleLink.id, sampleLink.orgId, Date.now() - ageDays * DAY_MS, dedupeId)
      .run();
  }

  async function dedupeIdOf(id: number) {
    const row = await env.DB.prepare("select dedupe_id from clicks where id = ?")
      .bind(id)
      .first<{ dedupe_id: string | null }>();
    return row?.dedupe_id;
  }

  it("indexes only live dedupe ids, not every swept click", async () => {
    const index = await env.DB.prepare(
      "select sql from sqlite_master where type = 'index' and name = 'idx_clicks_dedupe_id'",
    ).first<{ sql: string }>();

    expect(index?.sql.toLowerCase()).toContain("where dedupe_id is not null");
  });

  it("clears ids past the redelivery window and keeps the recent ones", async () => {
    await seedLink();
    await seedClick(1, 30, "dedupe-old");
    await seedClick(2, 1, "dedupe-recent");

    expect(await sweepDedupeIds(testEnv)).toBe(1);

    // The old row keeps its click, and loses only the index weight.
    expect(await dedupeIdOf(1)).toBeNull();
    expect(await dedupeIdOf(2)).toBe("dedupe-recent");
    const counted = await env.DB.prepare("select count(*) as n from clicks").all<{ n: number }>();
    expect(counted.results[0]?.n).toBe(2);
  });

  it("lets two swept rows sit side by side, since every NULL is distinct", async () => {
    await seedLink();
    await seedClick(1, 30, "dedupe-1");
    await seedClick(2, 30, "dedupe-2");

    expect(await sweepDedupeIds(testEnv)).toBe(2);

    expect(await dedupeIdOf(1)).toBeNull();
    expect(await dedupeIdOf(2)).toBeNull();
  });

  it("does nothing on a second run, so the daily job stays cheap", async () => {
    await seedLink();
    await seedClick(1, 30, "dedupe-old");

    expect(await sweepDedupeIds(testEnv)).toBe(1);
    expect(await sweepDedupeIds(testEnv)).toBe(0);
  });

  it("still refuses a duplicate dedupe id inside the window", async () => {
    await seedLink();
    await seedClick(1, 1, "same");
    await expect(seedClick(2, 1, "same")).rejects.toThrow();
  });
});

describe("isDeletedLink", () => {
  it("reads the constraint off the cause, where drizzle puts it", () => {
    // The whole classification hung on this and was dead code without it:
    // drizzle wraps a D1 failure in its own error whose message is the query
    // text, so the top-level message never names the constraint.
    const wrapped = new Error('Failed query: insert into "clicks" ...', {
      cause: new Error(
        "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)",
      ),
    });
    expect(isDeletedLink(wrapped)).toBe(true);
  });

  it("reads it off the message too, for a driver that does not wrap", () => {
    expect(isDeletedLink(new Error("FOREIGN KEY constraint failed"))).toBe(true);
  });

  it("calls anything else transient, so it keeps its remaining deliveries", () => {
    expect(isDeletedLink(new Error("D1_ERROR: network"))).toBe(false);
    expect(
      isDeletedLink(new Error("Failed query", { cause: new Error("D1_ERROR: timeout") })),
    ).toBe(false);
    expect(isDeletedLink(new Error("Failed query", { cause: "not an error" }))).toBe(false);
  });
});
