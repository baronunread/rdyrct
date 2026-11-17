import * as Sentry from "@sentry/cloudflare";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { type ClickMessage, insertClicks } from "./clicks";
import { captureAlert } from "./sentry";
import { logFailure } from "./log-failure";

/**
 * Replaced the click queue, which capped Free at ~3,300 redirects/day (#225). Memory only:
 * a DO evicted before its alarm loses that window, fine for analytics.
 * ponytail: single collector, shard by linkId hash if one instance saturates (~1,000 req/s).
 */

/** `CLICK_FLUSH_MS` overrides it so e2e does not wait out a 10 s alarm. */
const FLUSH_MS = 10_000;

const MAX_BUFFER = 5_000;

/** Counted in flushes, not time, so a broken D1 write is a bounded loss with one alert. */
const MAX_FLUSH_FAILS = 6;

export class ClickBuffer extends DurableObject<Env> {
  #buf: ClickMessage[] = [];
  #flushMs = Number(this.env.CLICK_FLUSH_MS) || FLUSH_MS;
  #flushing = false;
  #failedFlushes = 0;

  // add/alarm/buffered/reset are reached by RPC or by the runtime (the alarm),
  // which fallow's static graph cannot see.

  // fallow-ignore-next-line unused-class-member
  async add(row: ClickMessage): Promise<void> {
    this.#buf.push(row);
    if (this.#buf.length >= MAX_BUFFER) {
      await this.#flush();
      return;
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + this.#flushMs);
    }
  }

  // fallow-ignore-next-line unused-class-member
  async alarm(): Promise<void> {
    await this.#flush();
  }

  // fallow-ignore-next-line unused-class-member
  buffered(): ClickMessage[] {
    return [...this.#buf];
  }

  // fallow-ignore-next-line unused-class-member
  async reset(): Promise<void> {
    this.#buf = [];
    this.#failedFlushes = 0;
    await this.ctx.storage.deleteAlarm();
  }

  async #flush(): Promise<void> {
    if (this.#flushing || this.#buf.length === 0) return;
    this.#flushing = true;
    // Swapped out before the first await so a mid-flush click lands in the next batch.
    const rows = this.#buf;
    this.#buf = [];
    try {
      const { retry, hadFailure } = await insertClicks(this.env, rows);
      // Clamped: a negative slice bound would keep almost everything.
      this.#buf.unshift(...retry.slice(0, Math.max(0, MAX_BUFFER - this.#buf.length)));
      // A row deferred for the D1 subrequest budget is not a failure.
      this.#failedFlushes = hadFailure ? this.#failedFlushes + 1 : 0;
    } catch (error) {
      this.#buf.unshift(...rows.slice(0, Math.max(0, MAX_BUFFER - this.#buf.length)));
      this.#failedFlushes++;
      // Sentry is off wherever SENTRY_DSN is unset; this is the only trace of a lost flush.
      logFailure("click_flush_failed", error, { rows: rows.length });
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
      await this.ctx.storage.setAlarm(Date.now() + this.#flushMs);
    }
  }
}
