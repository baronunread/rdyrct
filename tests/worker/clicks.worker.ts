import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { env } from "cloudflare:workers";
import { reset, runDurableObjectAlarm } from "cloudflare:test";
import {
  insertClicks,
  isDeletedLink,
  sweepDedupeIds,
  type ClickMessage,
} from "../../src/worker/clicks";
import {
  applyTestMigrations,
  clicksStub,
  overrideEnv,
  resetClicks,
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
  await resetClicks();
});

/** A D1 binding whose every call fails, standing in for the database being
 * unavailable. The distinction insertClicks draws is "deleted link" against
 * "everything else", and a deleted link is the only per-row failure a test can
 * produce for real, so the other side needs the whole binding. */
function unavailableD1(): typeof env.DB {
  // One rejected promise, marked handled once and handed out to every call. A
  // fresh rejection per call leaks: drizzle's batch creates per-statement
  // promises it abandons as soon as the batch itself fails, and each surfaces
  // as an unhandled rejection that fails the run with every test green.
  const failure: Promise<never> = Promise.reject(new Error("D1_ERROR: network"));
  failure.catch(() => {});
  const reject = (): Promise<never> => failure;
  // SAFETY: insertClicks's drizzle queries reach only bind and the four result
  // methods; anything else raises a TypeError naming the member.
  const statement = {
    bind: () => statement,
    run: reject,
    all: reject,
    first: reject,
    raw: reject,
  } as D1PreparedStatement;
  const session = { prepare: () => statement, batch: reject, getBookmark: () => null };
  // SAFETY: insertClicks reaches only prepare and batch on this binding, and
  // both are present; anything else raises a TypeError naming the member.
  return {
    prepare: () => statement,
    batch: reject,
    exec: reject,
    dump: reject,
    withSession: () => session,
  } as typeof env.DB;
}

describe("the click buffer", () => {
  it("holds a click until the alarm, then writes it", async () => {
    await seedLink();
    const stub = clicksStub();

    await stub.add(clickMessage({ dedupeId: "a" }));
    expect(await clickCount()).toBe(0);

    // The alarm the add() scheduled, run now rather than after 10 s.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await clickCount()).toBe(1);
  });

  it("writes a whole window of clicks in one flush", async () => {
    await seedLink();
    const stub = clicksStub();
    for (let i = 0; i < 30; i++) await stub.add(clickMessage({ dedupeId: `n-${i}` }));

    await runDurableObjectAlarm(stub);

    expect(await clickCount()).toBe(30);
    expect(await stub.buffered()).toEqual([]);
  });

  it("does not double-count a click the previous flush already wrote", async () => {
    await seedLink();
    const stub = clicksStub();
    const message = clickMessage({ dedupeId: "dup" });

    await stub.add(message);
    await runDurableObjectAlarm(stub);
    // The same dedupeId comes round again (an alarm that re-ran after a
    // partial flush) and must not add a second row.
    await stub.add(message);
    await runDurableObjectAlarm(stub);

    expect(await clickCount()).toBe(1);
  });
});

describe("insertClicks", () => {
  it("writes a batch too big for one D1 statement as several", async () => {
    await seedLink();
    // A click row binds 8 values, so 100 rows in one statement would bind 800
    // parameters and exceed D1's cap of 100. insertClicks chunks internally.
    const rows = Array.from({ length: 100 }, (_, i) => clickMessage({ dedupeId: `bulk-${i}` }));

    expect(await insertClicks(testEnv, rows)).toEqual({ retry: [], hadFailure: false });

    expect(await clickCount()).toBe(100);
  });

  it("keeps every good click when one link was deleted, and counts the drop", async () => {
    await seedLink();
    const captureSpy = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => clickMessage({ dedupeId: `ok-${i}` })),
      clickMessage({ dedupeId: "bad", linkId: "no-such-link" }),
    ];

    // Nothing to retry, and a deleted link is not a failure: the nine good
    // rows landed and the tenth can never land, so it is dropped rather than
    // returned.
    expect(await insertClicks(testEnv, rows)).toEqual({ retry: [], hadFailure: false });

    expect(await clickCount()).toBe(9);
    expect(captureSpy).toHaveBeenCalledWith(
      "click_dropped_unwritable",
      expect.objectContaining({ level: "error", extra: expect.objectContaining({ count: 1 }) }),
    );
    captureSpy.mockRestore();
  });

  it("returns the rows to retry when the database is what failed, and drops nothing", async () => {
    const captureSpy = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");
    const rows = [clickMessage({ dedupeId: "a" }), clickMessage({ dedupeId: "b" })];

    const { retry, hadFailure } = await insertClicks(overrideEnv({ DB: unavailableD1() }), rows);

    expect(retry.map((r) => r.dedupeId).sort()).toEqual(["a", "b"]);
    expect(hadFailure).toBe(true);
    expect(captureSpy).not.toHaveBeenCalledWith("click_dropped_unwritable", expect.anything());
    captureSpy.mockRestore();
  });

  it("defers rows past the per-row subrequest budget instead of attempting them, and that is not a failure", async () => {
    await seedLink();
    // The batch attempt fails as a whole (one link is gone), so this falls
    // back to per-row. With more good rows than the fallback's
    // per-invocation budget, the rest come back as retry, unattempted --
    // not as failures, and not counted toward the give-up threshold.
    const rows = [
      clickMessage({ dedupeId: "bad", linkId: "no-such-link" }),
      ...Array.from({ length: 60 }, (_, i) => clickMessage({ dedupeId: `n-${i}` })),
    ];

    const { retry, hadFailure } = await insertClicks(testEnv, rows);

    expect(hadFailure).toBe(false); // nothing attempted actually failed
    expect(retry.length).toBeGreaterThan(0); // the rest were deferred, not attempted
    expect(await clickCount()).toBeLessThan(60);
  });

  it("dedupes a row that already landed", async () => {
    await seedLink();
    const shared = clickMessage({ dedupeId: "shared" });
    await insertClicks(testEnv, [shared]);
    expect(await clickCount()).toBe(1);

    // The same row rides a later batch that falls back to per-row because a
    // neighbour's link is gone. Dedupe has to survive the split.
    const { retry } = await insertClicks(testEnv, [
      shared,
      clickMessage({ dedupeId: "bad", linkId: "no-such-link" }),
    ]);

    expect(retry).toEqual([]);
    expect(await clickCount()).toBe(1);
  });

  it("does nothing with an empty batch", async () => {
    expect(await insertClicks(testEnv, [])).toEqual({ retry: [], hadFailure: false });
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

  it("clears ids past the retry window and keeps the recent ones", async () => {
    await seedLink();
    await seedClick(1, 30, "dedupe-old");
    await seedClick(2, 0, "dedupe-recent");

    expect(await sweepDedupeIds(testEnv)).toBe(1);

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
    await seedClick(1, 0, "same");
    await expect(seedClick(2, 0, "same")).rejects.toThrow();
  });
});

describe("isDeletedLink", () => {
  it("reads the constraint off the cause, where drizzle puts it", () => {
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

  it("calls anything else transient, so the click is retried rather than dropped", () => {
    expect(isDeletedLink(new Error("D1_ERROR: network"))).toBe(false);
    expect(
      isDeletedLink(new Error("Failed query", { cause: new Error("D1_ERROR: timeout") })),
    ).toBe(false);
    expect(isDeletedLink(new Error("Failed query", { cause: "not an error" }))).toBe(false);
  });
});
