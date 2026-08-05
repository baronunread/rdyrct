import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, Env } from "./env";
import type { KVLink } from "./kv";
import { now, deviceFromUA, normalizeReferrer } from "./util";
import { clickAnalyticsAllowed } from "./rate-limit";
import { alertBetterStack } from "./alerts";

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
      ts: now(),
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
 * transaction (a foreign key violation), so that batch retries and, if
 * the link stays gone, eventually dead-letters together with its batch
 * mates. That is a rare, small, accepted loss (see the top of this file),
 * not a bug: rather than splitting a failed batch to save the other rows,
 * we trust Cloudflare Queues' retry budget the same way storage.ts does.
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
        .onConflictDoNothing({ target: schema.clicks.dedupeId }),
    );
    await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
    batch.ackAll();
  } catch (error) {
    console.error("click batch insert failed", batch.messages.length, error);
    if (batch.messages.some((m) => m.attempts >= CLICK_MAX_DELIVERIES)) {
      console.error("click_batch_dead_letter", batch.messages.length);
    }
    batch.retryAll();
  }
}

/**
 * Consume the click dead-letter queue: log and alert for visibility, then
 * ack. Nothing repairs a dropped click; see the top of this file for why
 * that is the accepted behavior.
 */
export async function logClickDeadLetterBatch(
  env: Env,
  batch: MessageBatch<ClickMessage>,
): Promise<void> {
  const events = batch.messages.map((m) => ({
    event: "click_dropped",
    linkId: m.body.linkId,
    orgId: m.body.orgId,
  }));
  for (const event of events) console.error(event.event, event.linkId, event.orgId);
  await alertBetterStack(env, events);
  batch.ackAll();
}
