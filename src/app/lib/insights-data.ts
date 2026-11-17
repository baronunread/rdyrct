import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { DeltaValue, LinkStats, OrgInsights, OrgStats } from "@/shared/types";

export const useInsightStats = (orgId: string, days?: number, bucket?: "day" | "hour") =>
  useQuery(insightStatsQuery(orgId, days, bucket));

export const insightStatsQuery = (orgId: string, days?: number, bucket?: "day" | "hour") =>
  queryOptions<OrgStats>({
    queryKey: ["stats", orgId, days, bucket],
    queryFn: () => {
      const params = new URLSearchParams();
      if (days) params.set("days", String(days));
      if (bucket) params.set("bucket", bucket);
      const qs = params.size ? `?${params.toString()}` : "";
      return api<OrgStats>(`/orgs/${orgId}/stats${qs}`);
    },
    enabled: !!orgId,
    // A new range keeps the last one on screen so the chart crossfades.
    // Never across orgs: another org's numbers are not a placeholder for this one's.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === orgId ? previous : undefined,
  });

export const useOrgInsights = (orgId: string, days: number) =>
  useQuery(orgInsightsQuery(orgId, days));

export const orgInsightsQuery = (orgId: string, days: number) =>
  queryOptions<OrgInsights>({
    queryKey: ["insights", orgId, days],
    queryFn: () => api<OrgInsights>(`/orgs/${orgId}/insights?days=${days}`),
    enabled: !!orgId,
    staleTime: 60_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === orgId ? previous : undefined,
  });

// Keyed under ["linkStats", orgId] so every mutation that refreshes a link's
// stats refreshes this too.
export const useLinkInsightStats = (
  orgId: string,
  slug: string | null,
  domain: string | null,
  days?: number,
) => useQuery(linkInsightStatsQuery(orgId, slug, domain, days));

export const linkInsightStatsQuery = (
  orgId: string,
  slug: string | null,
  domain: string | null,
  days?: number,
) =>
  queryOptions<LinkStats>({
    queryKey: ["linkStats", orgId, slug, domain, days],
    queryFn: () => {
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      if (days) params.set("days", String(days));
      const qs = params.size ? `?${params.toString()}` : "";
      // SAFETY: `enabled` below holds the query until the slug is known.
      return api<LinkStats>(`/orgs/${orgId}/links/stats/${encodeURIComponent(slug!)}${qs}`);
    },
    enabled: !!orgId && !!slug,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === slug && previousQuery?.queryKey[3] === domain
        ? previous
        : undefined,
  });

export interface RangePreset {
  label: string;
  days: number;
  bucket?: "hour";
}

export const PRESET_24H: RangePreset = { label: "24h", days: 1, bucket: "hour" };
export const PRESET_7D: RangePreset = { label: "7d", days: 7 };
export const PRESET_30D: RangePreset = { label: "30d", days: 30 };
export const PRESET_365D: RangePreset = { label: "365d", days: 365 };

export const presetId = (p: { days: number; bucket?: "day" | "hour" }) =>
  `${p.days}-${p.bucket ?? "day"}`;

function deltaOf(current: number, previous: number): DeltaValue {
  return {
    current,
    previous,
    pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

export function clicksPerLink(s: OrgStats): { value: number; delta: DeltaValue | null } | null {
  if (!s.linksClicked) return null;
  const value = Math.round(s.totalClicks / s.linksClicked);
  const prevLinks = s.linksClickedDelta?.previous ?? 0;
  const prevClicks = s.totalClicksDelta?.previous ?? 0;
  const delta = prevLinks > 0 ? deltaOf(value, Math.round(prevClicks / prevLinks)) : null;
  return { value, delta };
}

export const deviceLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

export const sourceLabel = (key: string) => (key === "direct" ? "Direct" : key);

// "www." and "m." do not count: they would make half the list a W.
export function siteLetter(host: string): string {
  const bare = host.replace(/^(www|m)\./i, "");
  const letter = bare.match(/[a-z0-9]/i)?.[0];
  return (letter ?? "?").toUpperCase();
}

export function shortAgo(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
