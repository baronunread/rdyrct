import type { Context } from "hono";
import { nonEmpty } from "../shared/lookup";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Env } from "./env";
import type { AppEnv } from "./env";
import type { KVLink } from "./kv";
import { deviceFromUA, normalizeReferrer } from "./util";
import { clickAnalyticsAllowed } from "./rate-limit";
import { captureAlert } from "./sentry";

/**
 * Click ingestion. The redirect hot path never inserts into D1 itself: it
 * hands a compact event to the ClickBuffer Durable Object (click-buffer.ts)
 * and returns, so a traffic spike never competes with the redirect for D1
 * write capacity. The buffer turns each ~10 s window of clicks into one
 * multi-row insert, so a spike costs one D1 write per window instead of one
 * per click.
 *
 * A click is best-effort analytics, not a correctness-critical follow-up:
 * `enqueueClick` swallows its own failures instead of propagating them, so a
 * failed hand-off never fails the redirect itself. Losing clicks under
 * overload is the accepted tradeoff (issue #16); losing a KV/R2 sync is not,
 * which is why that path keeps its queue (storage.ts).
 */

export type ClickMessage = {
  // Assigned at the redirect, so a row written twice (an alarm that re-ran
  // after a partial flush) cannot double-count.
  dedupeId: string;
  linkId: string;
  addressId: string;
  orgId: string;
  ts: number;
  country: string;
  referrer: string;
  device: string;
};

/** The single ClickBuffer instance every redirect writes to. */
const BUFFER_NAME = "clicks";

// D1 caps bound parameters at 100 per statement. A click row binds 8 values,
// so one multi-row insert can hold at most floor(100 / 8) = 12 rows. A flush
// splits into several such statements run in one db.batch() call.
const CLICK_INSERT_CHUNK_SIZE = 12;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/* ---------------- producing ---------------- */

/**
 * Record one click. Best-effort: a rate limit or a failed hand-off to the
 * buffer is logged and swallowed here, never thrown, so the caller's redirect
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
    const buffer = c.env.CLICK_BUFFER.get(c.env.CLICK_BUFFER.idFromName(BUFFER_NAME));
    await buffer.add(message);
  } catch (error) {
    console.error("click enqueue failed", error);
  }
}

/* ---------------- writing (called by the buffer's flush) ---------------- */

function toRow(m: ClickMessage) {
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
 * Write a batch of buffered clicks.
 *
 * The happy path is one `db.batch()` of multi-row inserts, deduped on
 * `dedupeId` so a re-run after a partial flush never double-counts. Returns
 * the rows that hit a transient failure and should be tried again on the next
 * flush; an empty array means everything was either written or deliberately
 * dropped.
 *
 * A link deleted between the redirect and the flush turns its row into a
 * foreign-key violation that aborts the whole `db.batch`. Rather than lose a
 * whole window of clicks because one link went away (#102), the fallback
 * inserts row by row: the ones that land are kept, a row whose link is gone is
 * dropped and counted, and anything else is returned for retry.
 */
export async function insertClicks(env: Env, rows: ClickMessage[]): Promise<ClickMessage[]> {
  if (rows.length === 0) return [];
  const db = drizzle(env.DB, { schema });
  try {
    const writes = nonEmpty(
      chunk(rows, CLICK_INSERT_CHUNK_SIZE).map((c) =>
        // The dedupe constraint is a partial unique index (swept NULL ids are
        // absent from it). SQLite cannot match a column-only conflict target
        // to that index, so let it handle the one applicable unique conflict
        // without naming a target.
        db.insert(schema.clicks).values(c.map(toRow)).onConflictDoNothing(),
      ),
    );
    if (writes) await db.batch(writes);
    return [];
  } catch {
    return insertClicksPerRow(db, rows);
  }
}

async function insertClicksPerRow(
  db: ReturnType<typeof drizzle<typeof schema>>,
  rows: ClickMessage[],
): Promise<ClickMessage[]> {
  // Together, not one after another: the rows are independent and order does
  // not matter, because dedupe is an index, not a sequence.
  const outcomes = await Promise.all(
    rows.map(async (row) => {
      try {
        await db.insert(schema.clicks).values(toRow(row)).onConflictDoNothing();
        return { row, state: "ok" as const };
      } catch (error) {
        // Narrowed here: only an Error carries a message worth classifying,
        // and anything else is treated as transient.
        const gone = error instanceof Error && isDeletedLink(error);
        return { row, state: gone ? ("gone" as const) : ("retry" as const) };
      }
    }),
  );
  const gone: ClickMessage[] = [];
  const retry: ClickMessage[] = [];
  for (const { row, state } of outcomes) {
    if (state === "gone") gone.push(row);
    else if (state === "retry") retry.push(row);
  }
  if (gone.length > 0) {
    // Counted, so the accepted loss has a size rather than being a sentence in
    // a comment.
    captureAlert([
      {
        event: "click_dropped_unwritable",
        count: gone.length,
        orgIds: [...new Set(gone.map((r) => r.orgId))],
      },
    ]);
  }
  return retry;
}

/**
 * Is this insert failure a link that no longer exists?
 *
 * The two causes want opposite answers: a deleted link will never accept this
 * click however often it comes back, while a database that was briefly
 * unavailable will. Treating both as "drop it" reported a transient blip as a
 * permanent loss.
 */
export function isDeletedLink(error: Error): boolean {
  // `cause` as well as the message: drizzle wraps a D1 failure in its own
  // error whose message is the query text, and the constraint that actually
  // failed is only named on the cause.
  return (
    hasForeignKeyFailure(error) ||
    (error.cause instanceof Error && hasForeignKeyFailure(error.cause))
  );
}

const hasForeignKeyFailure = (error: Error): boolean =>
  error.message.includes("FOREIGN KEY constraint failed");

/* ---------------- sweeping ---------------- */

/**
 * How long a dedupe id stays useful (#70).
 *
 * A dedupe id exists so a re-run of the buffer's flush can discard a row it
 * already wrote, and a flush retries for at most a few minutes. A day is that
 * with wide margin.
 */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Same bound as the retention delete in scheduled(): one unbounded UPDATE on
// this table can exceed D1's statement limits once it is large.
const DEDUPE_SWEEP_CHUNK = 1000;

/**
 * Clear dedupe ids old enough that no flush retry can still reference them.
 *
 * `clicks` is the only unbounded table here and keeps 400 days, so a unique
 * index over every dedupe id ever issued was paying permanent cost for a
 * guarantee that lasts minutes (#70). The column and its index stay, because
 * the dedupe still has to work; what goes is the 36-character value on rows
 * old enough that no retry can reach them. SQLite's unique index allows any
 * number of NULLs, so the freed rows never collide with each other.
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
