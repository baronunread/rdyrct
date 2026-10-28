/**
 * Cursor pagination for an organization's links.
 *
 * The list used to return every row an org owned and let the browser slice
 * it. At the Pro cap that is 3,000 rows, each carrying two correlated
 * subqueries, fetched again on every visit to /links, so the page got slower
 * for exactly the customers who used the product most.
 *
 * Offset would have been the easy replacement and the wrong one. `limit ?
 * offset ?` still walks and discards every row before the one it wants, so
 * page 40 costs forty pages of work, and the walk is over a moving table: a
 * link created while somebody reads page 2 pushes a row from page 2 onto
 * page 3, where it is read twice, and a deleted one hides a row entirely.
 *
 * So the cursor is a value from the last row of the page rather than a count
 * of rows skipped: "the next 25 after this one" instead of "the 25 after the
 * first 500". The database seeks straight to it, and rows arriving above the
 * cursor cannot shift what comes below it.
 *
 * Every sort carries the row's id as a tiebreaker. Two links created in the
 * same millisecond, or sharing a slug across domains, would otherwise order
 * differently between two queries, and a page boundary landing between them
 * would drop one and repeat the other.
 */
import { and, eq, gt, lt, or, sql, type SQL } from "drizzle-orm";
import { oneOf } from "../shared/lookup";
import { LINK_FILTERS, type LinkFacets, type LinkFilter } from "../shared/types";
import * as v from "valibot";
import * as schema from "./db/schema";
import type { DB } from "./env";
import { computeWindows, linkClicksTotal } from "./rollups";

const LINK_SORTS = ["created", "slug", "clicks"] as const;
type LinkSort = (typeof LINK_SORTS)[number];

export const LINKS_PAGE_SIZE = 25;
const LINKS_MAX_PAGE_SIZE = 100;

/** The value a cursor carries, alongside the id that breaks its ties. */
type CursorValue = string | number;

export interface LinkPageParams {
  limit: number;
  sort: LinkSort;
  /** -1 for descending, which is what every column here defaults to. */
  dir: -1 | 1;
  cursor: { value: CursorValue; id: string } | null;
  q: string;
  /** "" for every domain, "shared" for the default host, else a hostname. */
  domain: string;
  /** Which chip is picked above the table. */
  filter: LinkFilter;
}

/**
 * Reads the paging parameters off a request, clamping anything a caller can
 * set. The limit is capped because it is the one parameter that decides how
 * much work a single request can ask for.
 */
export function readLinkPageParams(url: URL): LinkPageParams {
  // Not `Number(get(...))`: a missing parameter reads as 0, which clamps to
  // a page of one link rather than to the default.
  const raw = url.searchParams.get("limit");
  const asked = raw ? Number(raw) : NaN;
  const sort = url.searchParams.get("sort") ?? "";
  return {
    limit: Number.isFinite(asked)
      ? Math.min(Math.max(Math.trunc(asked), 1), LINKS_MAX_PAGE_SIZE)
      : LINKS_PAGE_SIZE,
    sort: oneOf(LINK_SORTS, sort, "created"),
    dir: url.searchParams.get("dir") === "asc" ? 1 : -1,
    cursor: decodeCursor(url.searchParams.get("cursor")),
    q: (url.searchParams.get("q") ?? "").trim(),
    domain: (url.searchParams.get("domain") ?? "").trim(),
    filter: oneOf(LINK_FILTERS, url.searchParams.get("filter") ?? "", "all"),
  };
}

/* ---------------- the chips: one definition for count and filter ---------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A link with a drop in clicks worth saying needs this many clicks in the
 * week before, so that half of them going is not noise. */
const DROP_FLOOR = 10;

// Literal `links.` and `click_daily.` columns throughout: these run as
// correlated subqueries, where an interpolated drizzle column renders
// unqualified and SQLite binds it to the subquery's own table.

/** The link's QR code has an override of its own. */
const hasQrSql = sql`(links.qr_logo <> '' or links.qr_style <> '' or links.qr_color <> ''
  or links.qr_corner <> '' or links.qr_bg <> '' or links.qr_eye_color <> ''
  or links.qr_logo_size is not null)`;

const customDomainSql = sql`(links.domain_id is not null)`;

/**
 * A link needs attention when it is paused, shows a warning, has gone a week
 * without a click after its first week, or its last 7 days fell under half
 * of the 7 before (from at least DROP_FLOOR). The "Needs attention" count and
 * filter both read this, and `attentionNote` below says the same thing in
 * words for one row. Weeks are whole UTC days, as on the stats pages.
 */
function attentionSql(now: number): SQL {
  const { since7, prev7Since } = computeWindows(7, now);
  const before = sql`coalesce(sum(case when click_daily.day < ${since7} then click_daily.clicks end), 0)`;
  const after = sql`coalesce(sum(case when click_daily.day >= ${since7} then click_daily.clicks end), 0)`;
  return sql`(links.suspended_at is not null
    or links.warned_at is not null
    or (links.created_at < ${now - 7 * DAY_MS} and not exists (
      select 1 from click_daily where click_daily.link_id = links.id and click_daily.day >= ${since7}))
    or exists (
      select 1 from click_daily where click_daily.link_id = links.id and click_daily.day >= ${prev7Since}
      group by click_daily.link_id having ${before} >= ${DROP_FLOOR} and 2 * ${after} < ${before}))`;
}

function chipSql(filter: LinkFilter, now: number): SQL | undefined {
  if (filter === "attention") return attentionSql(now);
  if (filter === "qr") return hasQrSql;
  if (filter === "custom") return customDomainSql;
  return undefined;
}

const countWhere = (cond: SQL) =>
  sql<number>`coalesce(sum(case when ${cond} then 1 else 0 end), 0)`;

/** The count beside each chip, over the org's whole list. */
export async function linkFacets(db: DB, orgId: string, now = Date.now()): Promise<LinkFacets> {
  const [row] = await db
    .select({
      all: sql<number>`count(*)`,
      attention: countWhere(attentionSql(now)),
      qr: countWhere(hasQrSql),
      customDomain: countWhere(customDomainSql),
    })
    .from(schema.links)
    .where(eq(schema.links.orgId, orgId));
  return row ?? { all: 0, attention: 0, qr: 0, customDomain: 0 };
}

/** Days read per row: two weeks, so "needs attention" can compare this week
 * with the one before. */
const SPARK_DAYS = 14;

/** Days a row's sparkline shows: one week, on every plan. The free plan's
 * analytics window is 7 days, and the table must not show more than the
 * plan's own charts do. */
export const SPARK_SHOWN = 7;

/** The first UTC day a sparkline covers. */
export const sparkSince = (now = Date.now()) => computeWindows(SPARK_DAYS, now).since;

/**
 * Each link's 14 daily counts, oldest first and zero-filled, out of the
 * rollup rows `sparkRows` read for the page.
 */
export function sparkLines(
  rows: { linkId: string; day: string; clicks: number }[],
  now = Date.now(),
): (linkId: string) => number[] {
  const first = Date.parse(`${sparkSince(now)}T00:00:00Z`);
  const empty = () => Array.from({ length: SPARK_DAYS }, () => 0);
  const byLink = new Map<string, number[]>();
  for (const r of rows) {
    const i = Math.round((Date.parse(`${r.day}T00:00:00Z`) - first) / DAY_MS);
    if (i < 0 || i >= SPARK_DAYS) continue;
    const line = byLink.get(r.linkId) ?? empty();
    line[i] = r.clicks;
    byLink.set(r.linkId, line);
  }
  return (linkId) => byLink.get(linkId) ?? empty();
}

/**
 * Why one listed link needs attention, in words, or null when it does not:
 * the rule in `attentionSql`, read off the row and its 14-day series. A
 * paused link says nothing here, because the table's "paused" badge already
 * says it.
 */
export function attentionNote(
  link: { warnedAt: number | null; createdAt: number },
  spark: number[],
  clicks: number,
  now = Date.now(),
): string | null {
  if (link.warnedAt !== null) return "Visitors see a warning";
  const before = spark.slice(0, 7).reduce((a, b) => a + b, 0);
  const after = spark.slice(7).reduce((a, b) => a + b, 0);
  if (after === 0 && link.createdAt < now - 7 * DAY_MS)
    return clicks === 0 ? "No clicks yet" : "No clicks in 7 days";
  if (before >= DROP_FLOOR && 2 * after < before)
    return `${Math.round((1 - after / before) * 100)}% fewer clicks`;
  return null;
}

/**
 * Opaque on purpose: base64 of the sort value and the id.
 *
 * Opaque because it is ours to change. A caller that takes it apart and
 * rebuilds it is a caller that breaks when the sort gains a column, and one
 * that can ask for a page from the middle of somebody else's ordering.
 */
/** A cursor as it travels: the sort value it stopped at, and the row id
 * that breaks ties. */
const cursorSchema = v.tuple([v.union([v.string(), v.number()]), v.string()]);

export function encodeCursor(value: CursorValue, id: string): string {
  return btoa(JSON.stringify([value, id]));
}

function decodeCursor(raw: string | null): { value: CursorValue; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = v.safeParse(cursorSchema, JSON.parse(atob(raw)));
    if (!parsed.success) return null;
    const [value, id] = parsed.output;
    return { value, id };
  } catch {
    // A cursor we cannot read is a first page, not an error: it is a URL
    // somebody may have kept, and the honest answer to a stale one is the
    // top of the list rather than a 400 about a parameter they never typed.
    return null;
  }
}

/** Clicks are counted per link, from the rollups (#26), so the sort and its
 * cursor share one expression with the count each row shows. */
const clicksExpr = linkClicksTotal;

function sortExpr(sort: LinkSort): SQL<unknown> {
  if (sort === "slug") return sql`${schema.links.slug}`;
  if (sort === "clicks") return clicksExpr;
  return sql`${schema.links.createdAt}`;
}

/**
 * The row this page starts after.
 *
 * `(value, id) < (cursorValue, cursorId)` written out, because SQLite has no
 * row-value comparison. Equal values fall through to the id, which is what
 * keeps a page boundary from splitting two rows that sort the same.
 */
function afterCursor(params: LinkPageParams): SQL | undefined {
  if (!params.cursor) return undefined;
  const value = sortExpr(params.sort);
  const beyond = params.dir === -1 ? lt : gt;
  return or(
    beyond(value, params.cursor.value),
    and(eq(value, params.cursor.value), beyond(schema.links.id, params.cursor.id)),
  );
}

/** Search and domain, which have to run in the query now that the browser
 * only ever holds one page to filter. */
function filters(params: LinkPageParams): (SQL | undefined)[] {
  const like = `%${params.q.toLowerCase()}%`;
  return [
    params.q
      ? or(
          sql`lower(${schema.links.slug}) like ${like}`,
          sql`lower(${schema.links.destination}) like ${like}`,
          sql`lower(${schema.links.title}) like ${like}`,
        )
      : undefined,
    params.domain === "shared" ? sql`${schema.links.domainId} is null` : undefined,
    params.domain && params.domain !== "shared" && params.domain !== "all"
      ? eq(schema.domains.hostname, params.domain)
      : undefined,
  ];
}

/** Everything the list query needs beyond its columns: what to keep, where to
 * resume, and in what order. */
export function linkPageQuery(orgId: string, params: LinkPageParams, now = Date.now()) {
  const value = sortExpr(params.sort);
  const direction = params.dir === -1 ? sql`desc` : sql`asc`;
  return {
    where: and(
      eq(schema.links.orgId, orgId),
      ...filters(params),
      chipSql(params.filter, now),
      afterCursor(params),
    ),
    // The id repeats the direction so the tiebreaker matches the comparison
    // the cursor makes.
    orderBy: sql`${value} ${direction}, ${schema.links.id} ${direction}`,
    // One more than asked for: whether the extra row exists is how we know
    // there is a next page, without a second count query over the table.
    limit: params.limit + 1,
  };
}

/** The value a row contributes to the cursor under a given sort. Beside the
 * sort expression it mirrors, so the two cannot drift. */
export function cursorValueOf(
  sort: LinkSort,
): (row: { slug: string; clicks: number; createdAt: number }) => CursorValue {
  if (sort === "slug") return (row) => row.slug;
  if (sort === "clicks") return (row) => row.clicks;
  return (row) => row.createdAt;
}

/**
 * Splits the extra row off the end and turns it into the next cursor.
 *
 * Returns the page the caller asked for plus the cursor that continues it,
 * or null when this was the last page.
 */
/** One page of rows, and the cursor that continues it. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function takePage<T extends { id: string }>(
  rows: T[],
  params: LinkPageParams,
  valueOf: (row: T) => CursorValue,
): Page<T> {
  if (rows.length <= params.limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, params.limit);
  const last = items[items.length - 1]!;
  return { items, nextCursor: encodeCursor(valueOf(last), last.id) };
}
