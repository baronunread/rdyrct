import { sql } from "drizzle-orm";
import type { DB, Env } from "./env";
import type { ClickMessage } from "./clicks";

/**
 * Clicks dropped past a plan's monthly cap, kept as a count for the abuse
 * sweep (#387).
 *
 * Past its cap an org's clicks are not stored (withinClickCaps), so anything
 * that counts rows in `clicks` reads zero for that org until the 1st. The
 * abuse checks (abuse.ts: the 24-hour ceiling, the one-hour burst, the
 * busy new link) would go blind exactly when an org's traffic is largest. So
 * the flush counts what it drops into `click_overflow`, per link per minute,
 * and the checks below add it to what `clicks` holds.
 *
 * Cost: one upsert per link-minute in a flush (a flush is ten seconds of
 * clicks), however many clicks it drops. A minute, not an hour, so the
 * sweep's windows still start within a minute of where they say: an
 * hour-wide bucket would let the one-hour burst check count two hours.
 *
 * Not deduped: a redelivered flush counts its dropped clicks again. That can
 * only overstate an org that is already past its cap, which is the side to
 * be wrong on for an abuse signal.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Twice the longest window the sweep reads. */
const KEEP_MS = 2 * DAY_MS;

/** The upsert that counts `dropped`, or null when there is nothing to count. */
export function overflowStatement(
  d1: D1Database,
  dropped: ClickMessage[],
): D1PreparedStatement | null {
  if (dropped.length === 0) return null;
  const payload = JSON.stringify(
    dropped.map((m) => [m.ts - (m.ts % MINUTE_MS), m.orgId, m.linkId]),
  );
  // WHERE true is SQLite's disambiguation before ON CONFLICT.
  return d1
    .prepare(
      `insert into click_overflow (minute, org_id, link_id, clicks)
       select value ->> 0, value ->> 1, value ->> 2, count(*) from json_each(?1) where true
       group by value ->> 0, value ->> 1, value ->> 2
       on conflict (minute, org_id, link_id) do update set clicks = clicks + excluded.clicks`,
    )
    .bind(payload);
}

/** The first minute bucket that overlaps a window starting at `since`. */
const fromMinute = (since: number) => since - (since % MINUTE_MS);

/**
 * Every org with at least `min` redirects since `since`, and its count:
 * the clicks stored plus the clicks dropped past a cap.
 */
export function redirectsByOrg(db: DB, since: number, min: number) {
  return db.all<{ orgId: string; n: number }>(sql`
    select org_id as orgId, sum(n) as n from (
      select org_id, count(*) as n from clicks where ts >= ${since} group by org_id
      union all
      select org_id, sum(clicks) from click_overflow where minute >= ${fromMinute(since)}
      group by org_id
    )
    group by org_id
    having sum(n) >= ${min}`);
}

/**
 * Every link made since `linksSince` with at least `min` redirects since
 * `since`, stored or dropped, with its org and its count.
 */
export function newLinksWithRedirects(db: DB, since: number, linksSince: number, min: number) {
  return db.all<{ orgId: string; linkId: string; n: number }>(sql`
    select org_id as orgId, link_id as linkId, sum(n) as n from (
      select c.org_id, c.link_id, count(*) as n
      from clicks c join links l on l.id = c.link_id
      where c.ts >= ${since} and l.created_at >= ${linksSince}
      group by c.org_id, c.link_id
      union all
      select o.org_id, o.link_id, sum(o.clicks)
      from click_overflow o join links l on l.id = o.link_id
      where o.minute >= ${fromMinute(since)} and l.created_at >= ${linksSince}
      group by o.org_id, o.link_id
    )
    group by org_id, link_id
    having sum(n) >= ${min}`);
}

/** The org's link with the most redirects since `since`, stored or dropped,
 * or null. */
export async function busiestLinkSince(
  db: DB,
  orgId: string,
  since: number,
): Promise<string | null> {
  const [top] = await db.all<{ linkId: string }>(sql`
    select link_id as linkId from (
      select link_id, count(*) as n from clicks
      where org_id = ${orgId} and ts >= ${since} group by link_id
      union all
      select link_id, sum(clicks) from click_overflow
      where org_id = ${orgId} and minute >= ${fromMinute(since)} group by link_id
    )
    group by link_id
    order by sum(n) desc
    limit 1`);
  return top?.linkId ?? null;
}

/** Daily: drop counts older than any window the sweep reads. In bounded
 * batches, like the raw clicks: a flood leaves a row per link per minute. */
export async function sweepOldOverflow(env: Env, now = Date.now()): Promise<void> {
  const stmt = env.DB.prepare(
    `delete from click_overflow where (minute, org_id, link_id) in (
       select minute, org_id, link_id from click_overflow where minute < ? limit 5000
     )`,
  ).bind(now - KEEP_MS);
  while ((await stmt.run()).meta.changes > 0);
}
