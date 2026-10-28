/**
 * The links page's data beyond the shared hooks: the filter counts, the
 * list rows, creator names and past imports.
 *
 * `qrCustom` asks for a flag the API does not send yet. It is optional, and
 * its reader treats "absent" as "do not show", so it appears the moment the
 * Worker starts answering. The shape is written out in
 * rdyrct-app-audit/overnight/links.md.
 */
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import type { LinkDTO, LinkFacets, LinkFilter, LinkListItem } from "@/shared/types";
import type { LinkImportHistory } from "@/shared/link-import";
import { api } from "./api";
import { useMembers } from "./hooks";

/** One row of the table: the list route's item, plus a flag the API may
 * grow: true when the link's QR code differs from the org's defaults, or has
 * been downloaded. */
export type LinkRow = LinkListItem & { qrCustom?: boolean };

export interface LinkPageQuery {
  q: string;
  domain: string;
  filter: LinkFilter;
  sort: "created" | "slug" | "clicks";
  dir: "asc" | "desc";
  limit: number;
  cursor: string | null;
}

function queryString(query: LinkPageQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.domain !== "all") params.set("domain", query.domain);
  if (query.filter !== "all") params.set("filter", query.filter);
  if (query.sort !== "created") params.set("sort", query.sort);
  if (query.dir === "asc") params.set("dir", "asc");
  params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

/**
 * One page of links, like `useLinks`, plus the chip's `filter`.
 *
 * The key starts ["links", orgId], so every invalidation the link mutations
 * already do (create, edit, delete, import) refreshes this too.
 */
export const useLinkRows = (orgId: string, query: LinkPageQuery) =>
  useQuery(linkRowsQuery(orgId, query));

export const linkRowsQuery = (orgId: string, query: LinkPageQuery) =>
  queryOptions<{ items: LinkRow[]; nextCursor: string | null }>({
    queryKey: ["links", orgId, "rows", query],
    queryFn: () => api(`/orgs/${orgId}/links?${queryString(query)}`),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

/** The chip counts. Until they arrive (or if they fail) the page shows no
 * chips, rather than chips with no numbers. */
export const useLinkFacets = (orgId: string) => useQuery(linkFacetsQuery(orgId));

export const linkFacetsQuery = (orgId: string) =>
  queryOptions<LinkFacets>({
    queryKey: ["links", orgId, "facets"],
    queryFn: () => api(`/orgs/${orgId}/links/facets`),
    enabled: !!orgId,
    staleTime: 30_000,
  });

/** Member names by user id, for "who made it" under each Created date. A
 * creator who has left the org is not in the list, and the row then shows
 * the date alone. */
export function useCreatorNames(orgId: string): Map<string, string> {
  const members = useMembers(orgId);
  return new Map((members.data ?? []).map((m) => [m.userId, m.name || m.email]));
}

/** Imports this org has finished, newest first. */
export const useImportHistory = (orgId: string) =>
  useQuery<LinkImportHistory>({
    queryKey: ["link-import", orgId, "history"],
    queryFn: () => api(`/orgs/${orgId}/link-import/history`),
    enabled: !!orgId,
  });

const DAY_MONTH = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Oct 23" this year, "Oct 23, 2025" before it. */
export function tableDate(ts: number): string {
  const date = new Date(ts);
  return (date.getFullYear() === new Date().getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(
    date,
  );
}

/** The link's address as one line, "go.example.com/slug". */
export function addressOf(link: Pick<LinkDTO, "url" | "slug">): string {
  return `${new URL(link.url).host}/${link.slug}`;
}

/** Whether a link's QR code looks different from the org's: any override set. */
export function hasQrOverride(link: LinkDTO): boolean {
  return Boolean(
    link.qrLogo ||
    link.qrStyle ||
    link.qrColor ||
    link.qrCorner ||
    link.qrBg ||
    link.qrEyeColor ||
    link.qrLogoSize !== null,
  );
}

/**
 * The line under a link's sparkline. A link that never had a click says so
 * in danger, whatever its age; anything else the server flagged (a drop, a
 * quiet week, a warning page) reads as a caution.
 */
export function trendNote(link: LinkRow): { tone: "warn" | "bad"; text: string } | null {
  if (link.clicks === 0) return { tone: "bad", text: "No clicks yet" };
  if (link.attention) return { tone: "warn", text: link.attention };
  return null;
}
