import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { getQueueResult, reset } from "cloudflare:test";
import {
  consumeClickBatch,
  logClickDeadLetterBatch,
  sweepDedupeIds,
  type ClickMessage,
} from "../../src/worker/clicks";
import {
  applyTestMigrations,
  batchOf,
  overrideEnv,
  sampleAddress,
  sampleLink,
  seedLink,
  testEnv,
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

  it("logs click_batch_dead_letter only once a message reaches its last delivery", async () => {
    await seedLink();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const loggedDeadLetter = () =>
      errors.mock.calls.some(([a]) => String(a).includes("click_batch_dead_letter"));

    const early = batchOf("rdyrct-clicks", [clickMessage({ linkId: "no-such-link" })], 1);
    await consumeClickBatch(testEnv, early.batch);
    expect(loggedDeadLetter()).toBe(false);

    const last = batchOf("rdyrct-clicks", [clickMessage({ linkId: "no-such-link" })], 6);
    await consumeClickBatch(testEnv, last.batch);
    expect(loggedDeadLetter()).toBe(true);
    errors.mockRestore();
  });
});

describe("click queue: dead-letter visibility", () => {
  it("logs and acks every message once it reaches the dead-letter queue", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { batch, ctx } = batchOf("rdyrct-clicks-dlq", [clickMessage()]);

    await logClickDeadLetterBatch(testEnv, batch);

    const result = await getQueueResult(batch, ctx);
    expect(result.ackAll).toBe(true);
    const logged = errors.mock.calls.map(([a]) => String(a));
    expect(logged.some((line) => line.includes("click_dropped"))).toBe(true);
    errors.mockRestore();
  });

  it("does not alert when Better Stack is unconfigured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { batch, ctx } = batchOf("rdyrct-clicks-dlq", [clickMessage()]);
    const unconfigured = overrideEnv({
      BETTERSTACK_SOURCE_TOKEN: undefined,
      BETTERSTACK_INGEST_URL: undefined,
    });

    await logClickDeadLetterBatch(unconfigured, batch);
    await getQueueResult(batch, ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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
