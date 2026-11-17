import type { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Env } from "./env";
import type { AppEnv } from "./env";
import type { KVLink } from "./kv";
import { rollupStatements, type ClickPayload } from "./rollups";
import { usageStatement, withinClickCaps } from "./click-caps";
import { overflowStatement } from "./click-overflow";
import { deviceFromUA, normalizeReferrer } from "./util";
import { clickAnalyticsAllowed, clickVisitorKey } from "./rate-limit";
import { captureAlert } from "./sentry";
import { logFailure } from "./log-failure";

// The redirect never inserts into D1: it hands the event to the ClickBuffer Durable Object, which writes one multi-row insert per ~10 s window.
// Clicks are best-effort: enqueueClick swallows its failures so a failed hand-off never fails the redirect (#16).
// Losing a KV/R2 sync is not acceptable, which is why storage.ts keeps its queue.

export type ClickMessage = {
  // Assigned at the redirect, so a row written twice (an alarm that re-ran) cannot double-count.
  dedupeId: string;
  linkId: string;
  addressId: string;
  orgId: string;
  ts: number;
  country: string;
  referrer: string;
  device: string;
};

const BUFFER_NAME = "clicks";

// Each chunk binds its rows as one JSON array, so D1 cap of 100 bound parameters does not apply; this keeps statements small.
const CLICK_CHUNK_SIZE = 200;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function enqueueClick(c: Context<AppEnv>, hit: KVLink): Promise<void> {
  try {
    // Per visitor, so a flood spends only its own budget. The digest lives in the limiter counter only: a click never stores an IP.
    const visitor = await clickVisitorKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
    if (!(await clickAnalyticsAllowed(c.env, hit.orgId, c.req.method, visitor))) return;
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
      // Hostname only (normalizeReferrer in util.ts, #20).
      referrer: normalizeReferrer(c.req.header("referer") ?? ""),
      device: deviceFromUA(c.req.header("user-agent") ?? ""),
    };
    const buffer = c.env.CLICK_BUFFER.get(c.env.CLICK_BUFFER.idFromName(BUFFER_NAME));
    await buffer.add(message);
  } catch (error) {
    logFailure("click_enqueue_failed", error);
  }
}

// The order is the dedupe guard: the raw insert skips a stored dedupe id (ON CONFLICT DO NOTHING), and the rollups count only rows whose id is not stored yet,
// read before the insert in the same transaction. A redelivered click is neither stored nor counted twice.
function writeChunk(d1: D1Database, rows: ClickMessage[]): D1PreparedStatement[] {
  const payload: ClickPayload = JSON.stringify(
    rows.map((m) => [
      m.linkId,
      m.orgId,
      m.ts,
      m.country,
      m.referrer,
      m.device,
      m.dedupeId,
      m.addressId,
    ]),
  );
  return [
    ...rollupStatements(d1, payload),
    usageStatement(d1, payload),
    // The dedupe constraint is a partial unique index, which SQLite cannot match to a column-only conflict target, so name none.
    // WHERE true is SQLite disambiguation before ON CONFLICT.
    d1
      .prepare(
        `insert into clicks (link_id, org_id, ts, country, referrer, device, dedupe_id, address_id)
         select value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6, value ->> 7
         from json_each(?1) where true
         on conflict do nothing`,
      )
      .bind(payload),
  ];
}

// hadFailure is true only when a row was attempted and failed, so a big healthy backlog never reads as failures.
export type InsertResult = { retry: ClickMessage[]; hadFailure: boolean };

// Workers Free allows 50 subrequests per invocation; the cap read, the failed batch and the overflow write spend three,
// and the per-row fallback spends one per row. Bound it so a big backlog drains over several flushes,
// and the skipped rows come back as retry.
const MAX_PER_ROW_FALLBACK = 40;

// Clicks past the monthly cap are dropped here (#387) but still counted per link-minute for the abuse sweep (click-overflow.ts).
// A link deleted before the flush makes a foreign-key violation that aborts the whole batch: the fallback inserts row by row,
// drops and counts rows whose link is gone, and returns the rest for retry (#102).
export async function insertClicks(env: Env, rows: ClickMessage[]): Promise<InsertResult> {
  let split: Awaited<ReturnType<typeof withinClickCaps>>;
  try {
    split = await withinClickCaps(env, rows);
  } catch (error) {
    // D1 failed, so every row comes back and counts toward the buffer give-up threshold.
    logFailure("click_cap_read_failed", error);
    return { retry: rows, hadFailure: rows.length > 0 };
  }
  const { counted, dropped } = split;
  const overflow = overflowStatement(env.DB, dropped);
  const writes = chunk(counted, CLICK_CHUNK_SIZE).flatMap((c) => writeChunk(env.DB, c));
  if (overflow) writes.push(overflow);
  if (writes.length === 0) return { retry: [], hadFailure: false };
  try {
    await env.DB.batch(writes);
    return { retry: [], hadFailure: false };
  } catch {
    // The batch rolled back the overflow count too. Nobody retries a dropped click, so this is its one try.
    if (overflow) await overflow.run().catch((error) => logFailure("click_overflow_failed", error));
    return insertClicksPerRow(env.DB, counted);
  }
}

async function insertClicksPerRow(d1: D1Database, rows: ClickMessage[]): Promise<InsertResult> {
  const attempt = rows.slice(0, MAX_PER_ROW_FALLBACK);
  const deferred = rows.slice(MAX_PER_ROW_FALLBACK);
  const outcomes = await Promise.all(
    attempt.map(async (row) => {
      try {
        await d1.batch(writeChunk(d1, [row]));
        return { row, state: "ok" as const };
      } catch (error) {
        const gone = error instanceof Error && isDeletedLink(error);
        // Sentry is off wherever SENTRY_DSN is unset (every e2e run), so this is the only trace a retried row leaves.
        if (!gone) logFailure("click_insert_failed", error);
        return { row, state: gone ? ("gone" as const) : ("retry" as const) };
      }
    }),
  );
  const gone: ClickMessage[] = [];
  const retry: ClickMessage[] = [...deferred];
  let hadFailure = false;
  for (const { row, state } of outcomes) {
    if (state === "gone") gone.push(row);
    else if (state === "retry") {
      retry.push(row);
      hadFailure = true;
    }
  }
  if (gone.length > 0) {
    captureAlert([
      {
        event: "click_dropped_unwritable",
        count: gone.length,
        orgIds: [...new Set(gone.map((r) => r.orgId))],
      },
    ]);
  }
  return { retry, hadFailure };
}

// A deleted link never accepts the click; a briefly unavailable database will. Treating both as drop reported a blip as permanent loss.
export function isDeletedLink(error: Error): boolean {
  // Check cause too: drizzle wraps a D1 failure in an error whose message is the query text; the constraint is named only on the cause.
  return (
    hasForeignKeyFailure(error) ||
    (error.cause instanceof Error && hasForeignKeyFailure(error.cause))
  );
}

const hasForeignKeyFailure = (error: Error): boolean =>
  error.message.includes("FOREIGN KEY constraint failed");

// A flush retries for a few minutes at most, so a day is wide margin (#70).
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Same bound as the retention delete: one unbounded UPDATE can exceed D1 statement limits.
const DEDUPE_SWEEP_CHUNK = 1000;

// idx_clicks_live_dedupe_ts (migration 0058) covers exactly the rows selected; idx_clicks_ts walked every old click (#489).
export const DEDUPE_SWEEP_SQL = `update clicks set dedupe_id = null where id in (
  select id from clicks where dedupe_id is not null and ts < ? limit ?
)`;

// The column and index stay for dedupe; what goes is the 36-character value on rows no retry can reach (#70).
// A unique index allows any number of NULLs.
export async function sweepDedupeIds(env: Env): Promise<number> {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  const stmt = env.DB.prepare(DEDUPE_SWEEP_SQL);
  let cleared = 0;
  let changes = 0;
  do {
    changes = (await stmt.bind(cutoff, DEDUPE_SWEEP_CHUNK).run()).meta.changes;
    cleared += changes;
  } while (changes > 0);
  return cleared;
}

// Through the same per-key limiter as real clicks, so reloading a link in a loop costs a bounded number of writes.
export async function countAnonClick(env: Env, id: string, method: string): Promise<void> {
  try {
    if (!(await clickAnalyticsAllowed(env, `anon:${id}`, method))) return;
    await drizzle(env.DB, { schema })
      .update(schema.anonLinks)
      .set({ clicks: sql`${schema.anonLinks.clicks} + 1` })
      .where(eq(schema.anonLinks.id, id));
  } catch (error) {
    logFailure("anon_click_count_failed", error);
  }
}
