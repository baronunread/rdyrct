// Cursor, not offset: offset walks and discards every row before the page, and a link created while someone reads page 2 shifts a row
// onto page 3 (read twice) or hides one. Every sort carries the row id as a tiebreaker, or a page boundary between two equal
// values drops one and repeats the other.
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

type CursorValue = string | number;

export interface LinkPageParams {
  limit: number;
  sort: LinkSort;
  dir: -1 | 1;
  cursor: { value: CursorValue; id: string } | null;
  q: string;
  domain: string;
  filter: LinkFilter;
}

// The limit is capped: it decides how much work one request can ask for.
export function readLinkPageParams(url: URL): LinkPageParams {
  // Not Number(get(...)): a missing parameter reads as 0, which clamps to a page of one.
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

const DAY_MS = 24 * 60 * 60 * 1000;

const DROP_FLOOR = 10;

// Literal links. and click_daily. columns: in a correlated subquery an interpolated drizzle column renders unqualified and SQLite binds it to the subquery own table.

const customDomainSql = sql`(links.domain_id is not null)`;

// attentionNote says the same in words for one row. Weeks are whole UTC days, as on the stats pages.
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
  if (filter === "custom") return customDomainSql;
  return undefined;
}

const countWhere = (cond: SQL) =>
  sql<number>`coalesce(sum(case when ${cond} then 1 else 0 end), 0)`;

export async function linkFacets(db: DB, orgId: string, now = Date.now()): Promise<LinkFacets> {
  const [row] = await db
    .select({
      all: sql<number>`count(*)`,
      attention: countWhere(attentionSql(now)),
      customDomain: countWhere(customDomainSql),
    })
    .from(schema.links)
    .where(eq(schema.links.orgId, orgId));
  return row ?? { all: 0, attention: 0, customDomain: 0 };
}

const SPARK_DAYS = 14;

// One week on every plan: the free analytics window is 7 days, and the table must not show more than the plan charts do.
export const SPARK_SHOWN = 7;

export const sparkSince = (now = Date.now()) => computeWindows(SPARK_DAYS, now).since;

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

// A paused link says nothing here, because the table paused badge already does.
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

// Opaque on purpose: it is ours to change, and a caller that rebuilds it breaks when the sort gains a column.
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
    // A cursor we cannot read is a first page, not a 400: it may be a URL somebody kept.
    return null;
  }
}

const clicksExpr = linkClicksTotal;

function sortExpr(sort: LinkSort): SQL<unknown> {
  if (sort === "slug") return sql`${schema.links.slug}`;
  if (sort === "clicks") return clicksExpr;
  return sql`${schema.links.createdAt}`;
}

// (value, id) < (cursorValue, cursorId) written out, because SQLite has no row-value comparison here.
function afterCursor(params: LinkPageParams): SQL | undefined {
  if (!params.cursor) return undefined;
  const value = sortExpr(params.sort);
  const beyond = params.dir === -1 ? lt : gt;
  return or(
    beyond(value, params.cursor.value),
    and(eq(value, params.cursor.value), beyond(schema.links.id, params.cursor.id)),
  );
}

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
    // The id repeats the direction so the tiebreaker matches the comparison the cursor makes.
    orderBy: sql`${value} ${direction}, ${schema.links.id} ${direction}`,
    // One more than asked for: the extra row tells us there is a next page without a count query.
    limit: params.limit + 1,
  };
}

// Beside the sort expression it mirrors, so the two cannot drift.
export function cursorValueOf(
  sort: LinkSort,
): (row: { slug: string; clicks: number; createdAt: number }) => CursorValue {
  if (sort === "slug") return (row) => row.slug;
  if (sort === "clicks") return (row) => row.clicks;
  return (row) => row.createdAt;
}

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
