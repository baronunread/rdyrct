import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import type { LinkDTO, LinkFacets, LinkFilter, LinkInput, LinkListItem } from "@/shared/types";
import type { LinkImportHistory } from "@/shared/link-import";
import { api } from "./api";
import { useMembers } from "./hooks";

export type LinkRow = LinkListItem;

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

// The key starts ["links", orgId], so every invalidation the link mutations
// already do (create, edit, delete, import) refreshes this too.
export const useLinkRows = (orgId: string, query: LinkPageQuery) =>
  useQuery(linkRowsQuery(orgId, query));

export const linkRowsQuery = (orgId: string, query: LinkPageQuery) =>
  queryOptions<{ items: LinkRow[]; nextCursor: string | null }>({
    queryKey: ["links", orgId, "rows", query],
    queryFn: () => api(`/orgs/${orgId}/links?${queryString(query)}`),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

export const useLinkFacets = (orgId: string) => useQuery(linkFacetsQuery(orgId));

export const linkFacetsQuery = (orgId: string) =>
  queryOptions<LinkFacets>({
    queryKey: ["links", orgId, "facets"],
    queryFn: () => api(`/orgs/${orgId}/links/facets`),
    enabled: !!orgId,
    staleTime: 30_000,
  });

export function useCreatorNames(orgId: string): Map<string, string> {
  const members = useMembers(orgId);
  return new Map((members.data ?? []).map((m) => [m.userId, m.name || m.email]));
}

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

export function tableDate(ts: number): string {
  const date = new Date(ts);
  return (date.getFullYear() === new Date().getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(
    date,
  );
}

export function addressOf(link: Pick<LinkDTO, "url" | "slug">): string {
  return `${new URL(link.url).host}/${link.slug}`;
}

export function trendNote(link: LinkRow): { tone: "warn" | "bad"; text: string } | null {
  if (link.clicks === 0) return { tone: "bad", text: "No clicks yet" };
  if (link.attention) return { tone: "warn", text: link.attention };
  return null;
}

export function linkFeatures(data: LinkInput) {
  const any = (...fields: (string | null | undefined)[]) => fields.some(Boolean);
  return {
    has_custom_domain: data.domainId !== null,
    has_custom_slug: Boolean(data.slug?.trim()),
    has_qr_customization: any(data.qrStyle, data.qrColor, data.qrCorner, data.qrLogo),
    has_utm_parameters: any(
      data.utmSource,
      data.utmMedium,
      data.utmCampaign,
      data.utmTerm,
      data.utmContent,
    ),
  };
}
