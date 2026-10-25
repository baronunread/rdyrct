import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";

/**
 * The analytics read model (#26).
 *
 * Every figure on the stats pages and every per-row count in the links list
 * reads `click_daily`, `click_daily_dims` and `click_hourly` (migration
 * 0042), never raw `clicks`. insertClicks keeps them current through
 * rollupStatements below, in the same batch that writes the raw rows. A query
 * here costs the link-days (or link-hours) in range, not the clicks.
 *
 * Windows are whole UTC days: "the last 7 days" is today and the six before
 * it, the same days the chart draws, so the total always equals the sum of
 * the bars. The last-24-hours view is whole UTC hours, the current one
 * included.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const daily = schema.clickDaily;
const dims = schema.clickDailyDims;
const hourly = schema.clickHourly;

/* ---------------- writing ---------------- */

/** A chunk of clicks as one JSON array of
 * [linkId, orgId, ts, country, referrer, device, dedupeId, addressId]
 * tuples, bound as a single parameter (see writeChunk in clicks.ts). */
export type ClickPayload = string;

// The clicks in ?1 that are not stored yet, once each. Read before the raw
// insert that follows these statements in the same batch, so a dedupe id
// already in `clicks` (a redelivered click) adds nothing here, and neither
// does the same id twice in one chunk.
const FRESH = `incoming as (
    select value ->> 0 as link_id, value ->> 1 as org_id, value ->> 2 as ts,
           value ->> 3 as country, value ->> 4 as referrer, value ->> 5 as device,
           value ->> 6 as dedupe_id
    from json_each(?1)
  ),
  fresh as (
    select * from incoming i
    where not exists (select 1 from clicks c where c.dedupe_id = i.dedupe_id)
    group by dedupe_id
  )`;

const DAY_OF = "date(ts / 1000, 'unixepoch')";

/**
 * Add a chunk of clicks to the three rollups: one upsert each, summed per key
 * first, so a flush costs a row write per link-day (or link-hour, or
 * dimension value), not per click. Must run before the chunk's raw insert,
 * in the same batch: see FRESH.
 */
export function rollupStatements(d1: D1Database, payload: ClickPayload): D1PreparedStatement[] {
  // WHERE true is SQLite's disambiguation before ON CONFLICT.
  return [
    `with ${FRESH}
     insert into click_daily (org_id, day, link_id, clicks)
     select org_id, ${DAY_OF}, link_id, count(*) from fresh where true
     group by link_id, ${DAY_OF}
     on conflict (org_id, day, link_id) do update set clicks = clicks + excluded.clicks`,
    `with ${FRESH}
     insert into click_daily_dims (org_id, dim, day, value, link_id, clicks)
     select org_id, dim, day, value, link_id, count(*) from (
       select org_id, 'country' as dim, ${DAY_OF} as day, country as value, link_id from fresh
       union all select org_id, 'referrer', ${DAY_OF}, referrer, link_id from fresh
       union all select org_id, 'device', ${DAY_OF}, device, link_id from fresh
     ) where true
     group by link_id, dim, day, value
     on conflict (org_id, dim, day, value, link_id) do update set clicks = clicks + excluded.clicks`,
    `with ${FRESH}
     insert into click_hourly (org_id, hour, link_id, clicks)
     select org_id, ts - ts % 3600000, link_id, count(*) from fresh where true
     group by link_id, ts - ts % 3600000
     on conflict (org_id, hour, link_id) do update set clicks = clicks + excluded.clicks`,
  ].map((query) => d1.prepare(query).bind(payload));
}

/* ---------------- reading ---------------- */

/** The UTC 'YYYY-MM-DD' a millisecond timestamp falls on. */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day keys (and one instant) each stats query starts from. */
export type StatsWindows = {
  /** First day of the selected range. */
  since: string;
  /** The same instant, for the hourly table. */
  sinceMs: number;
  /** First day of the equal-length range before it. */
  prevSince: string;
  since7: string;
  prev7Since: string;
  /** First day of the 30 a link must go without clicks to count as dead. */
  since30: string;
  /** First hour of the last-24-hours chart. */
  since24h: number;
};

export function computeWindows(days: number, now = Date.now()): StatsWindows {
  const today = now - (now % DAY_MS);
  const firstOf = (n: number) => today - (n - 1) * DAY_MS;
  return {
    since: dayKey(firstOf(days)),
    sinceMs: firstOf(days),
    prevSince: dayKey(firstOf(2 * days)),
    since7: dayKey(firstOf(7)),
    prev7Since: dayKey(firstOf(14)),
    since30: dayKey(firstOf(30)),
    since24h: now - (now % HOUR_MS) - 23 * HOUR_MS,
  };
}

const total = sql<number>`coalesce(sum(${daily.clicks}), 0)`;

/** Clicks in a [from, to) range of days, as one column of a single pass. */
function sumBetween(from: string, to?: string) {
  const inRange = to
    ? sql`${daily.day} >= ${from} and ${daily.day} < ${to}`
    : sql`${daily.day} >= ${from}`;
  return sql<number>`coalesce(sum(case when ${inRange} then ${daily.clicks} end), 0)`;
}

/**
 * The four headline figures (range, the range before it, last 7 days, the 7
 * before those) in one read, where raw clicks needed four counts.
 */
export async function headlineTotals(db: DB, scope: Scope, w: StatsWindows) {
  const [row] = await db
    .select({
      totalClicks: sumBetween(w.since),
      totalClicksPrev: sumBetween(w.prevSince, w.since),
      clicks7d: sumBetween(w.since7),
      clicks7dPrev: sumBetween(w.prev7Since, w.since7),
    })
    .from(daily)
    .where(
      and(
        scoped(daily, scope),
        gte(daily.day, w.prevSince < w.prev7Since ? w.prevSince : w.prev7Since),
      ),
    );
  return row ?? { totalClicks: 0, totalClicksPrev: 0, clicks7d: 0, clicks7dPrev: 0 };
}

/** Whose clicks a query counts: a whole org's, or one link's. */
export type Scope = { orgId: string } | { linkId: string };

function scoped(table: typeof daily | typeof dims, scope: Scope): SQL {
  return "orgId" in scope ? eq(table.orgId, scope.orgId) : eq(table.linkId, scope.linkId);
}

export function seriesRows(db: DB, scope: Scope, since: string) {
  return db
    .select({ day: daily.day, clicks: total })
    .from(daily)
    .where(and(scoped(daily, scope), gte(daily.day, since)))
    .groupBy(daily.day);
}

const dimTotal = sql<number>`sum(${dims.clicks})`;

/** One breakdown (countries, referrers or devices) over the range. */
export function dimensionRows(
  db: DB,
  scope: Scope,
  since: string,
  dimension: (typeof schema.CLICK_DIMENSIONS)[number],
  limit?: number,
) {
  const query = db
    .select({ key: dims.value, clicks: dimTotal })
    .from(dims)
    .where(and(scoped(dims, scope), eq(dims.dim, dimension), gte(dims.day, since)))
    .groupBy(dims.value)
    .orderBy(desc(dimTotal));
  return limit ? query.limit(limit) : query;
}

/** The last 24 hours, one row per UTC hour with clicks, labelled the way
 * the stats route's hour series expects. */
export function hourSeriesRows(db: DB, orgId: string, since24h: number) {
  return db
    .select({
      hour: sql<string>`strftime('%Y-%m-%d %H:00', ${hourly.hour} / 1000, 'unixepoch')`,
      clicks: sql<number>`sum(${hourly.clicks})`,
    })
    .from(hourly)
    .where(and(eq(hourly.orgId, orgId), gte(hourly.hour, since24h)))
    .groupBy(hourly.hour);
}

/** The last 24 hours and the 24 before them, for the 24-hour view's
 * headline figure and its delta. */
export async function lastDayByHour(db: DB, orgId: string, since24h: number) {
  const [row] = await db
    .select({
      totalClicks: sql<number>`coalesce(sum(case when ${hourly.hour} >= ${since24h} then ${hourly.clicks} end), 0)`,
      totalClicksPrev: sql<number>`coalesce(sum(case when ${hourly.hour} < ${since24h} then ${hourly.clicks} end), 0)`,
    })
    .from(hourly)
    .where(and(eq(hourly.orgId, orgId), gte(hourly.hour, since24h - DAY_MS)));
  return row ?? { totalClicks: 0, totalClicksPrev: 0 };
}

/** Clicks by weekday (Monday = 0) and UTC hour over the range. Integer
 * arithmetic rather than strftime, which costs more per row than the scan:
 * day 0 of the epoch was a Thursday, weekday 3 counting from Monday. */
export function heatmapRows(db: DB, orgId: string, sinceMs: number) {
  const dayOfWeek = sql<number>`(${hourly.hour} / 86400000 + 3) % 7`;
  const hourOfDay = sql<number>`(${hourly.hour} / 3600000) % 24`;
  return db
    .select({ dayOfWeek, hour: hourOfDay, clicks: sql<number>`sum(${hourly.clicks})` })
    .from(hourly)
    .where(and(eq(hourly.orgId, orgId), gte(hourly.hour, sinceMs)))
    .groupBy(dayOfWeek, hourOfDay);
}

/** The org's most-clicked links of all time. */
export function topLinkRows(db: DB, orgId: string) {
  return db
    .select({
      id: schema.links.id,
      slug: schema.links.slug,
      title: schema.links.title,
      clicks: total,
    })
    .from(schema.links)
    .innerJoin(daily, eq(daily.linkId, schema.links.id))
    .where(eq(schema.links.orgId, orgId))
    .groupBy(schema.links.id)
    .orderBy(desc(total))
    .limit(8);
}

/** Links that had clicks once and none in the last 30 days. A link that never
 * got a single click is not dead, just new or unshared. */
export function deadLinkRows(db: DB, orgId: string, since30: string) {
  return db
    .select({ id: schema.links.id, slug: schema.links.slug, title: schema.links.title })
    .from(schema.links)
    .where(
      and(
        eq(schema.links.orgId, orgId),
        sql`${schema.links.id} in (select link_id from click_daily where org_id = ${orgId})`,
        sql`${schema.links.id} not in (select link_id from click_daily where org_id = ${orgId} and day >= ${since30})`,
      ),
    )
    .limit(5);
}

/** Links whose last 7 days fell below half of the 7 before. */
export function decayingLinkRows(env: Env, orgId: string, w: StatsWindows) {
  return env.DB.prepare(
    `with cur as (select link_id, sum(clicks) as n from click_daily where org_id = ? and day >= ? group by link_id),
          prev as (select link_id, sum(clicks) as n from click_daily where org_id = ? and day >= ? and day < ? group by link_id),
          decay as (select cur.link_id, round((prev.n - cur.n) * 100.0 / prev.n) as drop_pct from cur join prev on cur.link_id = prev.link_id where prev.n > 0 and cur.n < prev.n * 0.5)
     select l.id, l.slug, l.title, d.drop_pct from decay d join links l on l.id = d.link_id order by d.drop_pct desc limit 5`,
  )
    .bind(orgId, w.since7, orgId, w.prev7Since, w.since7)
    .all<{ id: string; slug: string; title: string; drop_pct: number }>()
    .then((r) => r.results);
}

type UtmField = "utmCampaign" | "utmSource" | "utmMedium";

/** Clicks in range per value of one UTM field on the org's links. */
export function utmRows(db: DB, orgId: string, since: string, field: UtmField) {
  const value = schema.links[field];
  return db
    .select({ value, clicks: total })
    .from(schema.links)
    .innerJoin(daily, eq(daily.linkId, schema.links.id))
    .where(and(eq(schema.links.orgId, orgId), gte(daily.day, since), sql`length(${value}) > 0`))
    .groupBy(value)
    .orderBy(desc(total))
    .limit(8);
}

/** A link's clicks over every day kept, for the links list. Literal
 * `links.id`: an interpolated column renders unqualified, and SQLite resolves
 * it against the subquery's own table. */
export const linkClicksTotal = sql<number>`(
  select coalesce(sum(clicks), 0) from click_daily where click_daily.link_id = links.id
)`;

/** The same total for one link. */
export async function clicksForLink(db: DB, linkId: string): Promise<number> {
  const [row] = await db.select({ n: total }).from(daily).where(eq(daily.linkId, linkId));
  return row?.n ?? 0;
}

/**
 * How long rollups are kept. The same 400 days raw clicks are kept today
 * (the longest analytics window, Pro's 365, plus margin), stated on its own
 * so raw retention can shrink without taking the analytics with it.
 */
const ROLLUP_RETENTION_DAYS = 400;

/** Rows one sweep statement deletes at most, the same bound as the raw sweep
 * in scheduled(). */
const ROLLUP_SWEEP_CHUNK = 1000;

/** Sweep statements per D1 batch: a hundred orgs' worth. A batch is one
 * query against the Worker's per-invocation limit (50 on Free, 1,000 on
 * Paid) however many statements it holds, so a cron run that spends one per
 * ten orgs would run out of queries, and take every sweep after this one
 * with it, at a few thousand orgs. D1's 30-second limit covers the whole
 * batch: a daily run deletes about one day of rows per org, far inside it. */
const ROLLUP_SWEEP_BATCH = 300;

/**
 * One org's rows past the cutoff, at most ?3 of them. Every key starts with
 * org_id, so a delete on `day < ?` alone would read every row of the table:
 * these name the org (and, for the dims, every dim) so each reads only the
 * key range it deletes. The tables are WITHOUT ROWID, so the limit goes
 * through the key columns. Binds: org id, cutoff, limit.
 */
export const ROLLUP_SWEEP_SQL = [
  `delete from click_daily where (org_id, day, link_id) in (
     select org_id, day, link_id from click_daily where org_id = ?1 and day < ?2 limit ?3)`,
  `delete from click_daily_dims where (org_id, dim, day, value, link_id) in (
     select org_id, dim, day, value, link_id from click_daily_dims
     where org_id = ?1 and dim in ('country', 'referrer', 'device') and day < ?2 limit ?3)`,
  `delete from click_hourly where (org_id, hour, link_id) in (
     select org_id, hour, link_id from click_hourly where org_id = ?1 and hour < ?2 limit ?3)`,
] as const;

/**
 * Drop rollup rows older than the retention. Run daily, so each run removes
 * about one day of rows per org.
 *
 * Org by org rather than through a (day) index on each table: an index would
 * add a row write to every new link-day, dimension value and link-hour a
 * flush creates, every day, to save a read of the orgs table once a day. An
 * org with nothing to drop costs a key lookup per table that finds nothing.
 * A statement that deleted a full chunk runs again until one comes up short.
 *
 * Only orgs created before the cutoff's UTC day: every row is dated by the
 * redirect that made it, a link never moves to another org (a claimed
 * anonymous link is a new row in an org that already exists), so a younger
 * org has nothing old enough to drop. Queries per run: one for the orgs, then
 * one per hundred of them old enough to have rows past the retention.
 */
export async function sweepOldRollups(
  env: Env,
  now = Date.now(),
  chunk = ROLLUP_SWEEP_CHUNK,
): Promise<void> {
  const cutoff = now - ROLLUP_RETENTION_DAYS * DAY_MS;
  const cutoffDay = cutoff - (cutoff % DAY_MS);
  const cutoffs = [dayKey(cutoff), dayKey(cutoff), cutoffDay];
  const statements = ROLLUP_SWEEP_SQL.map((query) => env.DB.prepare(query));
  const { results: orgs } = await env.DB.prepare("select id from orgs where created_at < ?")
    .bind(cutoffDay)
    .all<{ id: string }>();

  let pending = orgs.flatMap(({ id }) =>
    statements.map((stmt, i) => stmt.bind(id, cutoffs[i], chunk)),
  );
  while (pending.length > 0) {
    const again: D1PreparedStatement[] = [];
    for (let i = 0; i < pending.length; i += ROLLUP_SWEEP_BATCH) {
      const group = pending.slice(i, i + ROLLUP_SWEEP_BATCH);
      // Sequential on purpose: D1 runs one write at a time, so batches sent
      // at once only queue behind each other, and holding the rest back
      // leaves room for the click flushes this daily job must not delay.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const results = await env.DB.batch(group);
      group.forEach((stmt, j) => {
        if ((results[j]?.meta.changes ?? 0) >= chunk) again.push(stmt);
      });
    }
    pending = again;
  }
}
