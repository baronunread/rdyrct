import * as Sentry from "@sentry/cloudflare";
import type { Context } from "hono";
import { nonEmpty } from "../shared/lookup";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, Env } from "./env";
import type { KVLink } from "./kv";
import { deviceFromUA, normalizeReferrer } from "./util";
import { clickAnalyticsAllowed } from "./rate-limit";
import { captureAlert } from "./sentry";

/**
 * Click ingestion. The redirect hot path never inserts into D1 itself: it
 * enqueues a compact event and returns, so a traffic spike never competes
 * with the redirect for D1 write capacity. The consumer below turns a whole
 * batch into one multi-row insert, so a spike costs one D1 write per batch
 * instead of one per click.
 *
 * Unlike the storage queue (storage.ts), a click is best-effort analytics,
 * not a correctness-critical follow-up: `enqueueClick` swallows its own
 * failures instead of propagating them, so a full click queue or an
 * exceeded analytics rate limit never fails the redirect itself. Losing
 * clicks under overload is the accepted tradeoff (issue #16); losing a
 * KV/R2 sync is not.
 */

export type ClickMessage = {
  // Producer-assigned, so a redelivered message can't double-insert.
  dedupeId: string;
  linkId: string;
  addressId: string;
  orgId: string;
  ts: number;
  country: string;
  referrer: string;
  device: string;
};

// A failure on this many deliveries dead-letters the batch. Keep in sync
// with the click consumer's max_retries + 1 in wrangler.jsonc.
const CLICK_MAX_DELIVERIES = 6;

// D1 caps bound parameters at 100 per statement. A click row binds 8 values,
// so a single multi-row insert statement can hold at most floor(100 / 8) = 12
// rows before it would exceed that cap. A queue batch (up to 100 messages)
// splits into several insert statements run in one db.batch() call: D1 runs
// them as one atomic unit, so the batch still acks or retries as a whole.
const CLICK_INSERT_CHUNK_SIZE = 12;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/* ---------------- producing ---------------- */

/**
 * Enqueue one click event. Best-effort: a rate limit or a queue-send failure
 * is logged and swallowed here, never thrown, so the caller's redirect
 * always ships regardless of analytics health.
 */
export async function enqueueClick(c: Context<AppEnv>, hit: KVLink): Promise<void> {
  try {
    if (!(await clickAnalyticsAllowed(c.env, hit.orgId, c.req.method))) return;
    const message: ClickMessage = {
      dedupeId: crypto.randomUUID(),
      linkId: hit.linkId,
      addressId: hit.addressId,
      orgId: hit.orgId,
      ts: Date.now(),
      // SAFETY: Cloudflare sets cf.country to a two-letter code, and its type
      // is the broad IncomingRequestCfProperties value. Unknown on a local
      // request, where the ?? below makes it empty.
      country: (c.req.raw.cf?.country as string) ?? "",
      // Hostname only, never the full URL the header carries: see
      // normalizeReferrer in util.ts and issue #20.
      referrer: normalizeReferrer(c.req.header("referer") ?? ""),
      device: deviceFromUA(c.req.header("user-agent") ?? ""),
    };
    await c.env.CLICK_QUEUE.send(message);
  } catch (error) {
    console.error("click enqueue failed", error);
  }
}

/* ---------------- consuming ---------------- */

/**
 * Consume a batch off the click queue: the whole batch's rows land in one
 * db.batch() transaction (split into D1-safe insert statements, see
 * CLICK_INSERT_CHUNK_SIZE above), deduped on `dedupeId` so a redelivery after
 * a partial failure never double-counts a click. The batch acks or retries
 * as a unit, matching the transaction: a hard D1 error aborts every
 * statement in it, while a duplicate `dedupeId` is skipped per row rather
 * than aborting anything.
 *
 * A link deleted between the redirect and this running fails the whole
 * transaction (a foreign key violation). While there are deliveries left
 * that is still answered by retrying the whole batch: it is one D1 write,
 * and it is what recovers a D1 outage without turning one bad batch into a
 * hundred separate writes.
 *
 * On the last delivery it would instead dead-letter, taking up to 99 valid
 * clicks with it because one link was deleted (#102). Link deletion is
 * ordinary use, not an incident, and the loss lands on whoever shared the
 * batch rather than on the person who deleted the link. So the last attempt
 * salvages instead: every row goes in on its own, the ones that land are
 * kept, and the ones that cannot are acked and counted rather than
 * retried forever.
 */
export async function consumeClickBatch(
  env: Env,
  batch: MessageBatch<ClickMessage>,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  try {
    const inserts = chunk(batch.messages, CLICK_INSERT_CHUNK_SIZE).map((rows) =>
      db
        .insert(schema.clicks)
        .values(
          rows.map((m) => ({
            linkId: m.body.linkId,
            addressId: m.body.addressId,
            orgId: m.body.orgId,
            ts: m.body.ts,
            country: m.body.country,
            referrer: m.body.referrer,
            device: m.body.device,
            dedupeId: m.body.dedupeId,
          })),
        )
        // The dedupe constraint is a partial unique index: swept NULL ids are
        // deliberately absent from it. SQLite cannot match a column-only
        // conflict target to that index, so let it handle the one applicable
        // unique conflict without naming a target.
        .onConflictDoNothing(),
    );
    const writes = nonEmpty(inserts);
    if (writes) await db.batch(writes);
    batch.ackAll();
  } catch (error) {
    Sentry.captureException(error, { extra: { batchSize: batch.messages.length } });
    // Deliveries left: retry the whole batch, unchanged. One write, and a D1
    // outage recovers from it with no per-row amplification.
    if (!onLastDelivery(batch)) {
      batch.retryAll();
      return;
    }
    await salvageClickBatch(db, batch);
  }
}

/** True when failing again would dead-letter these messages rather than
 * redeliver them. `attempts` counts the delivery in progress. */
function onLastDelivery(batch: MessageBatch<ClickMessage>): boolean {
  return batch.messages.some((m) => m.attempts >= CLICK_MAX_DELIVERIES);
}

function clickRow(message: Message<ClickMessage>) {
  const m = message.body;
  return {
    linkId: m.linkId,
    addressId: m.addressId,
    orgId: m.orgId,
    ts: m.ts,
    country: m.country,
    referrer: m.referrer,
    device: m.device,
    dedupeId: m.dedupeId,
  };
}

/**
 * Is this insert failure a link that no longer exists?
 *
 * The two causes want opposite answers: a deleted link will never accept this
 * click however often it comes back, while a database that was briefly
 * unavailable will. Treating both as "drop it" retried nothing and reported a
 * transient blip as a permanent loss.
 */
export function isDeletedLink(error: Error): boolean {
  // `cause` as well as the message: drizzle wraps a D1 failure in its own
  // error whose message is the query text, and the constraint that actually
  // failed is only named on the cause. Reading the top-level message alone
  // never matched, so every failure looked transient.
  return (
    hasForeignKeyFailure(error) ||
    (error.cause instanceof Error && hasForeignKeyFailure(error.cause))
  );
}

const hasForeignKeyFailure = (error: Error): boolean =>
  error.message.includes("FOREIGN KEY constraint failed");

/**
 * The last delivery, one row at a time, so one unwritable click cannot take
 * the batch down with it.
 *
 * Dedupe is unchanged: every row still carries its `dedupeId` and still
 * conflicts against the same unique index, so a row that landed in an earlier
 * delivery is skipped here rather than counted twice.
 *
 * When nothing at all writes, this is a failing database rather than a
 * deleted link, and the batch retries as a whole. It dead-letters either way
 * at this point, but retrying keeps that indistinguishable from today rather
 * than silently acking a hundred clicks D1 never saw.
 */
async function salvageClickBatch(
  db: ReturnType<typeof drizzle<typeof schema>>,
  batch: MessageBatch<ClickMessage>,
): Promise<void> {
  // Together, not one after another: the rows are independent, a batch is at
  // most 100 of them, and this only runs on a delivery that has already
  // failed five times. Order does not matter because dedupe is an index, not
  // a sequence.
  const outcomes = await Promise.all(
    batch.messages.map(async (message) => {
      try {
        await db.insert(schema.clicks).values(clickRow(message)).onConflictDoNothing({
          target: schema.clicks.dedupeId,
        });
        return null;
      } catch (error) {
        // Narrowed here, where it arrives: only an Error carries a message
        // worth classifying, and anything else is treated as transient.
        return { message, unwritable: error instanceof Error && isDeletedLink(error) };
      }
    }),
  );
  const failures = new Map(
    outcomes.flatMap((o) => (o === null ? [] : [[o.message, o.unwritable] as const])),
  );
  const stored = batch.messages.length - failures.size;
  // Nothing wrote, and no failure was a deleted link: the database is what
  // went wrong, so the whole batch retries, dead-letter log included, rather
  // than silently acking clicks D1 never saw. Asking about the failures
  // rather than about `stored` matters for a batch whose messages all name
  // one busy link that was just deleted: that is not an outage, and those
  // clicks should be acked and counted like any other.
  if (stored === 0 && [...failures.values()].every((unwritable) => !unwritable)) {
    console.error("click_batch_dead_letter", batch.messages.length);
    batch.retryAll();
    return;
  }
  // Per message, not ackAll. Cloudflare re-batches a redelivered message with
  // fresh ones, so "some message here is on its last delivery" says nothing
  // about the rest: acking the batch would drop a click that failed once and
  // still has five deliveries to go, which is a bigger loss than the one this
  // whole function exists to prevent.
  const unwritableDropped: Message<ClickMessage>[] = [];
  for (const message of batch.messages) {
    const unwritable = failures.get(message);
    if (unwritable === undefined) {
      message.ack();
    } else if (unwritable) {
      // The link is gone, so this click has nowhere to go however many times
      // it comes back. Acking now saves the redeliveries that would reach the
      // same answer.
      message.ack();
      unwritableDropped.push(message);
    } else if (message.attempts >= CLICK_MAX_DELIVERIES) {
      // Something else went wrong and there are no deliveries left. It is
      // lost either way; acking keeps it out of the dead-letter queue, where
      // it would only be logged again. It is not counted as unwritable: a
      // transient database failure is a different kind of loss.
      message.ack();
    } else {
      // Something else went wrong and there is still time to try again.
      message.retry();
    }
  }
  if (unwritableDropped.length > 0) {
    // Counted, so the accepted loss has a size rather than being a sentence
    // in a comment.
    captureAlert([
      {
        event: "click_dropped_unwritable",
        count: unwritableDropped.length,
        batchSize: batch.messages.length,
        orgIds: [...new Set(unwritableDropped.map((m) => m.body.orgId))],
      },
    ]);
    console.error("click_dropped_unwritable", unwritableDropped.length, batch.messages.length);
  }
}

/* ---------------- sweeping ---------------- */

/**
 * How long a dedupe id stays useful (#70).
 *
 * A dedupe id exists so the consumer above can discard a *redelivered*
 * message, and Cloudflare Queues stops redelivering long before this: the
 * click consumer gives up after CLICK_MAX_DELIVERIES, and a message cannot
 * outlive the queue's own retention of 4 days. Seven days is that ceiling
 * with room to spare.
 */
const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Same bound as the retention delete in scheduled(): one unbounded UPDATE on
// this table can exceed D1's statement limits once it is large.
const DEDUPE_SWEEP_CHUNK = 1000;

/**
 * Clear dedupe ids the queue can no longer redeliver.
 *
 * `clicks` is the only unbounded table here and keeps 400 days, so a unique
 * index over every dedupe id ever issued was paying permanent cost for a
 * guarantee that lasts minutes (#70). The column and its index stay, because
 * the dedupe still has to work; what goes is the 36-character value on rows
 * old enough that no redelivery can reach them. SQLite's unique index allows
 * any number of NULLs, so the freed rows never collide with each other.
 */
export async function sweepDedupeIds(env: Env): Promise<number> {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  const stmt = env.DB.prepare(
    `update clicks set dedupe_id = null where id in (
       select id from clicks where dedupe_id is not null and ts < ? limit ?
     )`,
  );
  let cleared = 0;
  let changes = 0;
  do {
    changes = (await stmt.bind(cutoff, DEDUPE_SWEEP_CHUNK).run()).meta.changes;
    cleared += changes;
  } while (changes > 0);
  return cleared;
}

/**
 * Consume the click dead-letter queue: log and alert for visibility, then
 * ack. Nothing repairs a dropped click; see the top of this file for why
 * that is the accepted behavior.
 */
export async function logClickDeadLetterBatch(batch: MessageBatch<ClickMessage>): Promise<void> {
  const events = batch.messages.map((m) => ({
    event: "click_dropped",
    linkId: m.body.linkId,
    orgId: m.body.orgId,
  }));
  captureAlert(events);
  batch.ackAll();
}
