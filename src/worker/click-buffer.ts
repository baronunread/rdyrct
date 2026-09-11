import * as Sentry from "@sentry/cloudflare";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { type ClickMessage, insertClicks } from "./clicks";
import { captureAlert } from "./sentry";

/**
 * The click buffer (#225).
 *
 * Click ingestion used to be a queue: one message per redirect, ~3 Cloudflare
 * Queues operations each, unbounded by traffic. On the Workers Free plan that
 * capped the whole platform at ~3,300 redirects/day before the queue froze
 * (incident 2026-09-10). One Durable Object, addressed `idFromName("clicks")`,
 * takes its place: every redirect calls `add`, the rows sit in memory, and a
 * ~10 s alarm flushes them to D1 in one batch. Per click that is one DO
 * request, not three queue ops, and D1 sees one write per flush regardless of
 * click rate.
 *
 * The buffer is memory only. A DO evicted in the few seconds before its alarm
 * fires loses that window, which is the same best-effort contract the queue
 * gave (`enqueueClick` always swallowed its own failures): a lost click is
 * analytics, not correctness. Persisting each click to `ctx.storage` would buy
 * that back at the cost of one SQLite row write per click, which is the
 * amplification this change exists to remove.
 *
 * One instance is enough: a single DO handles ~1,000 req/s, far past current
 * volume.
 * ponytail: single collector, shard by linkId hash if one instance saturates.
 */

/** Flush the buffer this long after the first click lands in an empty one. */
const FLUSH_MS = 10_000;

/** Flush early rather than let a spike grow the buffer without bound. At ~120
 * bytes a row this is well under a megabyte of instance memory. */
const MAX_BUFFER = 5_000;

/** Drop the buffer after this many consecutive failed flushes, so a broken D1
 * write is a bounded loss with one alert rather than a silent forever-retry. */
const MAX_FLUSH_FAILS = 6;

export class ClickBuffer extends DurableObject<Env> {
  #buf: ClickMessage[] = [];
  #flushing = false;
  #failedFlushes = 0;

  /** Record one click. Returns immediately; the write happens on the alarm. */
  async add(row: ClickMessage): Promise<void> {
    this.#buf.push(row);
    if (this.#buf.length >= MAX_BUFFER) {
      await this.#flush();
      return;
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + FLUSH_MS);
    }
  }

  async alarm(): Promise<void> {
    await this.#flush();
  }

  /** The rows waiting to be written. Test inspection only. */
  buffered(): ClickMessage[] {
    return [...this.#buf];
  }

  /** Drop everything pending. Test cleanup only. */
  async reset(): Promise<void> {
    this.#buf = [];
    this.#failedFlushes = 0;
    await this.ctx.storage.deleteAlarm();
  }

  async #flush(): Promise<void> {
    if (this.#flushing || this.#buf.length === 0) return;
    this.#flushing = true;
    // Swap the buffer out synchronously, before the first await, so a click
    // that arrives mid-flush lands in the next batch rather than this one.
    const rows = this.#buf;
    this.#buf = [];
    try {
      const retry = await insertClicks(this.env, rows);
      this.#buf.unshift(...retry.slice(0, MAX_BUFFER - this.#buf.length));
      this.#failedFlushes = retry.length === 0 ? 0 : this.#failedFlushes + 1;
    } catch (error) {
      // insertClicks handles a per-row failure itself; reaching here is
      // something unexpected. Keep the rows for the next alarm.
      this.#buf.unshift(...rows.slice(0, MAX_BUFFER - this.#buf.length));
      this.#failedFlushes++;
      Sentry.captureException(error, { extra: { pending: this.#buf.length } });
    } finally {
      this.#flushing = false;
    }

    if (this.#failedFlushes >= MAX_FLUSH_FAILS && this.#buf.length > 0) {
      captureAlert([{ event: "click_buffer_gave_up", count: this.#buf.length }]);
      this.#buf = [];
      this.#failedFlushes = 0;
      return;
    }
    if (this.#buf.length > 0 && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + FLUSH_MS);
    }
  }
}
