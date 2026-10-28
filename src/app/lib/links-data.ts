/**
 * The links page's data beyond the shared hooks: the filter counts, the
 * extra per-row fields the redesigned table reads, creator names and past
 * imports.
 *
 * Several of these ask for things the API may not send yet. Each one is
 * optional on the type and every reader treats "absent" as "do not show",
 * so the page works today and the column, chip or list appears the moment
 * the Worker starts answering. The shapes are written out in
 * rdyrct-app-audit/overnight/links.md.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { LinkDTO } from "@/shared/types";
import { api } from "./api";
import { useMembers } from "./hooks";

/** Which slice of the links the chips above the table pick. */
export type LinkFilter = "all" | "attention" | "qr" | "custom";

/** What one row may carry on top of LinkDTO. All optional: an API that has
 * not grown them yet sends none, and the table leaves their places out. */
export interface LinkRowExtras {
  /** Clicks per day for the last 14 days, oldest first, 14 entries. */
  spark?: number[];
  /** Why the link needs a look ("82% fewer clicks"), or null when it is fine. */
  attention?: string | null;
  /** True when the link's QR code differs from the org's defaults, or has
   * been downloaded: what the "QR codes" chip counts. */
  qrCustom?: boolean;
}

export type LinkRow = LinkDTO & LinkRowExtras;

/** The counts beside each chip (GET /orgs/:orgId/links/facets). */
export interface LinkFacets {
  all: number;
  attention: number;
  qr: number;
  customDomain: number;
}

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
  useQuery<{ items: LinkRow[]; nextCursor: string | null }>({
    queryKey: ["links", orgId, "rows", query],
    queryFn: () => api(`/orgs/${orgId}/links?${queryString(query)}`),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

/**
 * The chip counts. A 404 means the Worker has no facets route yet: the page
 * then shows no chips at all rather than chips that would not filter.
 */
export const useLinkFacets = (orgId: string) =>
  useQuery<LinkFacets>({
    queryKey: ["links", orgId, "facets"],
    queryFn: () => api(`/orgs/${orgId}/links/facets`),
    enabled: !!orgId,
    retry: false,
    staleTime: 30_000,
  });

/** Member names by user id, for "who made it" under each Created date. A
 * creator who has left the org is not in the list, and the row then shows
 * the date alone. */
export function useCreatorNames(orgId: string): Map<string, string> {
  const members = useMembers(orgId);
  return new Map((members.data ?? []).map((m) => [m.userId, m.name || m.email]));
}

/** One finished import (GET /orgs/:orgId/link-import/history). */
interface PastImport {
  id: string;
  service: string;
  imported: number;
  exists: number;
  failed: number;
  /** Epoch ms the import finished. */
  finishedAt: number;
}

/** Imports this org has finished, newest first. A 404 (no history route yet)
 * hides the "Past imports" list. */
export const useImportHistory = (orgId: string, enabled: boolean) =>
  useQuery<{ imports: PastImport[] }>({
    queryKey: ["link-import", orgId, "history"],
    queryFn: () => api(`/orgs/${orgId}/link-import/history`),
    enabled: enabled && !!orgId,
    retry: false,
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
 * What the trend says about a link, from its 14 days: no clicks at all, or a
 * second week well under the first. The server's own `attention` wins when it
 * sends one; this is only for a series without it.
 */
export function trendNote(link: LinkRow): { tone: "warn" | "bad"; text: string } | null {
  if (link.attention) return { tone: "warn", text: link.attention };
  if (link.clicks === 0) return { tone: "bad", text: "No clicks yet" };
  const spark = link.spark;
  if (!spark || spark.length < 14) return null;
  const before = spark.slice(0, 7).reduce((a, b) => a + b, 0);
  const after = spark.slice(7).reduce((a, b) => a + b, 0);
  // A drop worth saying needs a first week with enough clicks that half of
  // them going is not noise.
  if (before < 10 || after >= before / 2) return null;
  return { tone: "warn", text: `${Math.round((1 - after / before) * 100)}% fewer clicks` };
}
