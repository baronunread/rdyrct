import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { DeltaValue, LinkStats, OrgStats } from "@/shared/types";

/** The org's stats for a range, with the crossfade between ranges. */
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
    // A new range keeps the last one on screen until it arrives, so the
    // chart crossfades instead of the page dropping to a skeleton. Never
    // across orgs: another org's numbers are not a placeholder for this one's.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === orgId ? previous : undefined,
  });

/**
 * One link's stats for a range, clamped by the API to the plan's window
 * (`rangeDays` says which it answered). Keyed under ["linkStats", orgId] so
 * every mutation that refreshes a link's stats refreshes this too.
 */
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
    // Same link, new range: keep the last answer up while the next loads.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === slug && previousQuery?.queryKey[3] === domain
        ? previous
        : undefined,
  });

/** One preset on a range control: "24h" is the only hourly one. */
export interface RangePreset {
  label: string;
  days: number;
  bucket?: "hour";
}

export const PRESET_24H: RangePreset = { label: "24h", days: 1, bucket: "hour" };
export const PRESET_7D: RangePreset = { label: "7d", days: 7 };
export const PRESET_30D: RangePreset = { label: "30d", days: 30 };
export const PRESET_365D: RangePreset = { label: "365d", days: 365 };

/** "1-hour" or "30-day": one id per preset, for the segmented control. */
export const presetId = (p: { days: number; bucket?: "day" | "hour" }) =>
  `${p.days}-${p.bucket ?? "day"}`;

/** A figure against the one before it, the way the API words it. */
function deltaOf(current: number, previous: number): DeltaValue {
  return {
    current,
    previous,
    pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

/** Clicks per clicked link, and its change against the period before. */
export function clicksPerLink(s: OrgStats): { value: number; delta: DeltaValue | null } | null {
  if (!s.linksClicked) return null;
  const value = Math.round(s.totalClicks / s.linksClicked);
  const prevLinks = s.linksClickedDelta?.previous ?? 0;
  const prevClicks = s.totalClicksDelta?.previous ?? 0;
  const delta = prevLinks > 0 ? deltaOf(value, Math.round(prevClicks / prevLinks)) : null;
  return { value, delta };
}

/** "mobile" as "Mobile": the API's device keys are lower case. */
export const deviceLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

/** A referrer as people say it: the API's "direct" is "Direct". */
export const sourceLabel = (key: string) => (key === "direct" ? "Direct" : key);

/**
 * The flag emoji for a two-letter country code, or null for anything else
 * ("unknown", or a code the edge could not place). Regional indicator
 * symbols: the platform draws the flag, so no image and nothing remote.
 */
export function flagEmoji(code: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  const base = 0x1f1e6 - 65;
  const upper = code.toUpperCase();
  return String.fromCodePoint(base + upper.charCodeAt(0), base + upper.charCodeAt(1));
}

/**
 * The first letter of a site, for the tile that stands in for its favicon
 * (the CSP allows no remote images). "www." and "m." do not count: they
 * would make half the list a W.
 */
export function siteLetter(host: string): string {
  const bare = host.replace(/^(www|m)\./i, "");
  const letter = bare.match(/[a-z0-9]/i)?.[0];
  return (letter ?? "?").toUpperCase();
}

/** "now", "2m", "14m", "1h", "3d": a time a narrow column can hold. Past a
 * month it says the date ("Oct 5"). */
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
