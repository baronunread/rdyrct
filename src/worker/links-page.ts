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
import * as schema from "./db/schema";

export const LINK_SORTS = ["created", "slug", "clicks"] as const;
export type LinkSort = (typeof LINK_SORTS)[number];

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
    sort: (LINK_SORTS as readonly string[]).includes(sort) ? (sort as LinkSort) : "created",
    dir: url.searchParams.get("dir") === "asc" ? 1 : -1,
    cursor: decodeCursor(url.searchParams.get("cursor")),
    q: (url.searchParams.get("q") ?? "").trim(),
    domain: (url.searchParams.get("domain") ?? "").trim(),
  };
}

/**
 * Opaque on purpose: base64 of the sort value and the id.
 *
 * Opaque because it is ours to change. A caller that takes it apart and
 * rebuilds it is a caller that breaks when the sort gains a column, and one
 * that can ask for a page from the middle of somebody else's ordering.
 */
export function encodeCursor(value: CursorValue, id: string): string {
  return btoa(JSON.stringify([value, id]));
}

function decodeCursor(raw: string | null): { value: CursorValue; id: string } | null {
  if (!raw) return null;
  try {
    const [value, id] = JSON.parse(atob(raw)) as [CursorValue, string];
    if ((typeof value !== "string" && typeof value !== "number") || typeof id !== "string")
      return null;
    return { value, id };
  } catch {
    // A cursor we cannot read is a first page, not an error: it is a URL
    // somebody may have kept, and the honest answer to a stale one is the
    // top of the list rather than a 400 about a parameter they never typed.
    return null;
  }
}

/** Clicks are counted per link, so the sort and its cursor share one
 * expression. Literal `links.id`, because an interpolated column renders
 * unqualified and SQLite resolves it against the subquery's own table. */
const clicksExpr = sql<number>`(select count(*) from clicks where clicks.link_id = links.id)`;

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
export function linkPageQuery(orgId: string, params: LinkPageParams) {
  const value = sortExpr(params.sort);
  const direction = params.dir === -1 ? sql`desc` : sql`asc`;
  return {
    where: and(eq(schema.links.orgId, orgId), ...filters(params), afterCursor(params)),
    // The id repeats the direction so the tiebreaker matches the comparison
    // the cursor makes.
    orderBy: sql`${value} ${direction}, ${schema.links.id} ${direction}`,
    // One more than asked for: whether the extra row exists is how we know
    // there is a next page, without a second count query over the table.
    limit: params.limit + 1,
  };
}

/**
 * Splits the extra row off the end and turns it into the next cursor.
 *
 * Returns the page the caller asked for plus the cursor that continues it,
 * or null when this was the last page.
 */
export function takePage<T extends { id: string }>(
  rows: T[],
  params: LinkPageParams,
  valueOf: (row: T) => CursorValue,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= params.limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, params.limit);
  const last = items[items.length - 1]!;
  return { items, nextCursor: encodeCursor(valueOf(last), last.id) };
}
