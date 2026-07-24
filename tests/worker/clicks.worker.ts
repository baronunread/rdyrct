import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { getQueueResult, reset } from "cloudflare:test";
import type { Env } from "../../src/worker/env";
import {
  consumeClickBatch,
  logClickDeadLetterBatch,
  type ClickMessage,
} from "../../src/worker/clicks";
import { applyTestMigrations, batchOf, overrideEnv, sampleLink, seedLink } from "./support";

function clickMessage(overrides: Partial<ClickMessage> = {}): ClickMessage {
  return {
    dedupeId: crypto.randomUUID(),
    linkId: sampleLink.id,
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

    await consumeClickBatch(env as Env, batch);

    expect(await clickCount()).toBe(3);
    const result = await getQueueResult(batch, ctx);
    expect(result.ackAll).toBe(true);
  });

  it("dedupes a redelivered message instead of double-inserting", async () => {
    await seedLink();
    const message = clickMessage({ dedupeId: "dup-1" });

    await consumeClickBatch(env as Env, batchOf("rdyrct-clicks", [message]).batch);
    expect(await clickCount()).toBe(1);

    // A redelivery of the exact same message (same dedupeId) must not add a
    // second row.
    await consumeClickBatch(env as Env, batchOf("rdyrct-clicks", [message]).batch);
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

    await consumeClickBatch(env as Env, batch);
    const failed = await getQueueResult(batch, ctx);
    expect(failed.retryBatch.retry).toBe(true);
    expect(await clickCount()).toBe(0);

    // Once the bad message is gone (dead-lettered after exhausting retries,
    // in production), a redelivery of the surviving message succeeds.
    const retry = batchOf("rdyrct-clicks", [clickMessage({ dedupeId: "ok" })]);
    await consumeClickBatch(env as Env, retry.batch);
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
    await consumeClickBatch(env as Env, early.batch);
    expect(loggedDeadLetter()).toBe(false);

    const last = batchOf("rdyrct-clicks", [clickMessage({ linkId: "no-such-link" })], 6);
    await consumeClickBatch(env as Env, last.batch);
    expect(loggedDeadLetter()).toBe(true);
    errors.mockRestore();
  });
});

describe("click queue: dead-letter visibility", () => {
  it("logs and acks every message once it reaches the dead-letter queue", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { batch, ctx } = batchOf("rdyrct-clicks-dlq", [clickMessage()]);

    await logClickDeadLetterBatch(env as Env, batch);

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
