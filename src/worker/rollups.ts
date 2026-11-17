import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";

/**
 * Every stats figure reads `click_daily`, `click_daily_dims` and `click_hourly`
 * (migration 0042), never raw `clicks` (#26). Windows are whole UTC days, so a
 * total equals the sum of the chart's bars.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const daily = schema.clickDaily;
const dims = schema.clickDailyDims;
const hourly = schema.clickHourly;

export type ClickPayload = string;

// Read before the raw insert in the same batch, so a redelivered click (or a duplicate id in a chunk) adds nothing.
// Exported for click-caps.ts, which must count exactly what the rollups count.
export const FRESH = `incoming as (
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

/** Must run before the chunk's raw insert, in the same batch: see FRESH. */
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

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type StatsWindows = {
  since: string;
  sinceMs: number;
  prevSince: string;
  since7: string;
  prev7Since: string;
  since30: string;
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

function sumBetween(from: string, to?: string) {
  const inRange = to
    ? sql`${daily.day} >= ${from} and ${daily.day} < ${to}`
    : sql`${daily.day} >= ${from}`;
  return sql<number>`coalesce(sum(case when ${inRange} then ${daily.clicks} end), 0)`;
}

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

/** The edge sends no country, or "XX", when it cannot place a visitor. */
export async function countryCount(db: DB, scope: Scope, since: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${dims.value})` })
    .from(dims)
    .where(
      and(
        scoped(dims, scope),
        eq(dims.dim, "country"),
        gte(dims.day, since),
        sql`${dims.value} not in ('', 'XX')`,
      ),
    );
  return row?.n ?? 0;
}

export async function linksClickedCounts(db: DB, orgId: string, w: StatsWindows) {
  const [row] = await db
    .select({
      current: sql<number>`count(distinct case when ${daily.day} >= ${w.since} then ${daily.linkId} end)`,
      previous: sql<number>`count(distinct case when ${daily.day} < ${w.since} then ${daily.linkId} end)`,
    })
    .from(daily)
    .where(and(eq(daily.orgId, orgId), gte(daily.day, w.prevSince)));
  return row ?? { current: 0, previous: 0 };
}

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

/** Integer arithmetic rather than strftime, which costs more per row: epoch day 0 was a Thursday. */
export function heatmapRows(db: DB, orgId: string, sinceMs: number) {
  const dayOfWeek = sql<number>`(${hourly.hour} / 86400000 + 3) % 7`;
  const hourOfDay = sql<number>`(${hourly.hour} / 3600000) % 24`;
  return db
    .select({ dayOfWeek, hour: hourOfDay, clicks: sql<number>`sum(${hourly.clicks})` })
    .from(hourly)
    .where(and(eq(hourly.orgId, orgId), gte(hourly.hour, sinceMs)))
    .groupBy(dayOfWeek, hourOfDay);
}

const linkRef = {
  id: schema.links.id,
  slug: schema.links.slug,
  title: schema.links.title,
  domain: schema.domains.hostname,
};

/** The cards show seven and "Show all" opens the rest. Countries have no cap. */
export const STATS_LIST_LIMIT = 50;

export function topLinkRows(db: DB, orgId: string, since: string) {
  return db
    .select({ ...linkRef, clicks: total })
    .from(daily)
    .innerJoin(schema.links, eq(daily.linkId, schema.links.id))
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(and(eq(daily.orgId, orgId), gte(daily.day, since)))
    .groupBy(schema.links.id)
    .orderBy(desc(total))
    .limit(STATS_LIST_LIMIT);
}

export async function everClicked(db: DB, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(daily)
    .where(eq(daily.orgId, orgId))
    .limit(1);
  return !!row;
}

/** The ids travel as one JSON parameter: D1 binds at most 100 and a page can hold 100. */
export function sparkRows(db: DB, orgId: string, linkIds: string[], since: string) {
  return db
    .select({ linkId: daily.linkId, day: daily.day, clicks: daily.clicks })
    .from(daily)
    .where(
      and(
        eq(daily.orgId, orgId),
        gte(daily.day, since),
        sql`${daily.linkId} in (select value from json_each(${JSON.stringify(linkIds)}))`,
      ),
    );
}

/** Links that had clicks once and none in the last 30 days. A link that never
 * got a single click is not dead, just new or unshared. */
export function deadLinkRows(db: DB, orgId: string, since30: string) {
  return db
    .select(linkRef)
    .from(schema.links)
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(
      and(
        eq(schema.links.orgId, orgId),
        sql`${schema.links.id} in (select link_id from click_daily where org_id = ${orgId})`,
        sql`${schema.links.id} not in (select link_id from click_daily where org_id = ${orgId} and day >= ${since30})`,
      ),
    )
    .limit(5);
}

export function decayingLinkRows(env: Env, orgId: string, w: StatsWindows) {
  return env.DB.prepare(
    `with cur as (select link_id, sum(clicks) as n from click_daily where org_id = ? and day >= ? group by link_id),
          prev as (select link_id, sum(clicks) as n from click_daily where org_id = ? and day >= ? and day < ? group by link_id),
          decay as (select cur.link_id, round((prev.n - cur.n) * 100.0 / prev.n) as drop_pct from cur join prev on cur.link_id = prev.link_id where prev.n > 0 and cur.n < prev.n * 0.5)
     select l.id, l.slug, l.title, dm.hostname as domain, d.drop_pct from decay d join links l on l.id = d.link_id
     left join domains dm on dm.id = l.domain_id order by d.drop_pct desc limit 5`,
  )
    .bind(orgId, w.since7, orgId, w.prev7Since, w.since7)
    .all<{ id: string; slug: string; title: string; domain: string | null; drop_pct: number }>()
    .then((r) => r.results);
}

type UtmField = "utmCampaign" | "utmSource" | "utmMedium";

export function utmRows(db: DB, scope: Scope, since: string, field: UtmField) {
  const value = schema.links[field];
  const owner =
    "orgId" in scope ? eq(schema.links.orgId, scope.orgId) : eq(schema.links.id, scope.linkId);
  return db
    .select({ value, clicks: total })
    .from(schema.links)
    .innerJoin(daily, eq(daily.linkId, schema.links.id))
    .where(and(owner, gte(daily.day, since), sql`length(${value}) > 0`))
    .groupBy(value)
    .orderBy(desc(total))
    .limit(STATS_LIST_LIMIT);
}

/** Literal `links.id`: an interpolated column renders unqualified and binds to the subquery's own table. */
export const linkClicksTotal = sql<number>`(
  select coalesce(sum(clicks), 0) from click_daily where click_daily.link_id = links.id
)`;

export async function clicksForLink(db: DB, linkId: string): Promise<number> {
  const [row] = await db.select({ n: total }).from(daily).where(eq(daily.linkId, linkId));
  return row?.n ?? 0;
}

/** Stated on its own so raw retention can shrink without taking the analytics with it. */
const ROLLUP_RETENTION_DAYS = 400;

const ROLLUP_SWEEP_CHUNK = 1000;

/**
 * A batch is one query against the per-invocation limit (50 on Free, 1,000 on Paid)
 * however many statements it holds, so one per ten orgs would run out of queries
 * at a few thousand orgs and take every later sweep with it.
 */
const ROLLUP_SWEEP_BATCH = 300;

/** A copy on Workers Free has 50 queries for the whole cron run, so this must stop growing with the org count. */
const ROLLUP_SWEEP_ORGS_PER_RUN = 1000;

const ROLLUP_SWEEP_MAX_BATCHES = 15;

/** Over ceil(n / cap) days each org comes round, with nothing stored between runs. */
export function orgsForDay(ids: string[], day: number, cap: number): string[] {
  const slices = Math.ceil(ids.length / cap);
  if (slices <= 1) return ids;
  const start = (day % slices) * cap;
  return ids.slice(start, start + cap);
}

/**
 * Every key starts with org_id, so a delete on `day < ?` alone would read the whole
 * table. The tables are WITHOUT ROWID, so the limit goes through the key columns.
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
 * Org by org rather than a (day) index per table: an index adds a row write to every
 * new link-day a flush creates, to save one read a day. Only orgs created before the
 * cutoff's UTC day: a link never moves orgs, so a younger org has nothing old enough.
 */
export async function sweepOldRollups(
  env: Env,
  now = Date.now(),
  chunk = ROLLUP_SWEEP_CHUNK,
  orgsPerRun = ROLLUP_SWEEP_ORGS_PER_RUN,
): Promise<void> {
  const cutoff = now - ROLLUP_RETENTION_DAYS * DAY_MS;
  const cutoffDay = cutoff - (cutoff % DAY_MS);
  const cutoffs = [dayKey(cutoff), dayKey(cutoff), cutoffDay];
  const statements = ROLLUP_SWEEP_SQL.map((query) => env.DB.prepare(query));
  const { results: orgs } = await env.DB.prepare(
    "select id from orgs where created_at < ? order by id",
  )
    .bind(cutoffDay)
    .all<{ id: string }>();
  const ids = orgsForDay(
    orgs.map((o) => o.id),
    Math.floor(now / DAY_MS),
    orgsPerRun,
  );

  const queue = ids.flatMap((id) => statements.map((stmt, i) => stmt.bind(id, cutoffs[i], chunk)));
  for (let budget = ROLLUP_SWEEP_MAX_BATCHES; queue.length > 0 && budget > 0; budget--) {
    const group = queue.splice(0, ROLLUP_SWEEP_BATCH);
    // Sequential: D1 runs one write at a time, and holding batches back leaves room for click flushes.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const results = await env.DB.batch(group);
    group.forEach((stmt, j) => {
      if ((results[j]?.meta.changes ?? 0) >= chunk) queue.push(stmt);
    });
  }
}
