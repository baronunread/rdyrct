import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as v from "valibot";
import type { OrgStats, TopEntry } from "@/shared/types";
import { api } from "../lib/api";
import { useCurrentOrg } from "../lib/current-org";
import { useCurrentUser } from "../lib/hooks";
import { registerWebMcpTools, type WebMcpTool } from "../lib/webmcp";

const analyticsInput = v.object({
  days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365))),
  focus: v.optional(v.picklist(["overview", "acquisition", "link_health"])),
});

function topEntries(entries: TopEntry[]): string {
  return entries
    .slice(0, 5)
    .map(({ key, clicks }) => `${key}: ${clicks}`)
    .join(", ");
}

function noneWhenEmpty(value: string): string {
  return value || "none";
}

function campaigns(stats: OrgStats): string {
  return stats.campaigns
    .slice(0, 5)
    .map(({ campaign, clicks }) => `${campaign}: ${clicks}`)
    .join(", ");
}

function overview(stats: OrgStats): string {
  const topLinks = stats.topLinks
    .slice(0, 5)
    .map(({ slug, title, clicks }) => `${slug}${title ? ` (${title})` : ""}: ${clicks}`)
    .join(", ");
  return `Analytics for the current organization, last ${stats.rangeDays} days: ${stats.totalClicks} total clicks, ${stats.clicks7d} in the last 7 days, ${stats.totalLinks} active links. Top links: ${topLinks || "none yet"}.`;
}

function acquisition(stats: OrgStats): string {
  return `Acquisition, last ${stats.rangeDays} days. Countries: ${noneWhenEmpty(topEntries(stats.countries))}. Referrers: ${noneWhenEmpty(topEntries(stats.referrers))}. Devices: ${noneWhenEmpty(topEntries(stats.devices))}. Campaigns: ${noneWhenEmpty(campaigns(stats))}.`;
}

function linkHealth(stats: OrgStats): string {
  const dead = stats.deadLinks
    .slice(0, 10)
    .map(({ slug, title }) => `${slug}${title ? ` (${title})` : ""}`)
    .join(", ");
  const decaying = stats.decayingLinks
    .slice(0, 10)
    .map(({ slug, drop }) => `${slug}: ${drop}% down`)
    .join(", ");
  return `Link health, last ${stats.rangeDays} days. No-click links: ${dead || "none"}. Links with a 50%+ week-over-week drop: ${decaying || "none"}.`;
}

function analyticsSummary(
  stats: OrgStats,
  focus: "overview" | "acquisition" | "link_health",
): string {
  if (focus === "acquisition") return acquisition(stats).slice(0, 1_500);
  if (focus === "link_health") return linkHealth(stats).slice(0, 1_500);
  return overview(stats).slice(0, 1_500);
}

function statsQuery(days: number | undefined): string {
  return days ? `?days=${days}` : "";
}

/** Read-only organization analytics for browser agents, scoped by the existing API. */
export function WebMcpAnalyticsTool() {
  const currentUser = useCurrentUser();
  const { org } = useCurrentOrg();
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentUser.data || !org) return;

    const tools: WebMcpTool[] = [
      {
        name: "get_analytics",
        description:
          "Read analytics for the current organization. Choose overview for totals and top links, acquisition for countries, referrers, devices and campaigns, or link_health for dead and declining links.",
        inputSchema: {
          type: "object",
          properties: {
            days: { type: "number", minimum: 1, maximum: 365 },
            focus: { type: "string", enum: ["overview", "acquisition", "link_health"] },
          },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async (input, { signal }) => {
          const parsed = v.safeParse(analyticsInput, input);
          if (!parsed.success) return "Choose a whole number of days and a valid analytics focus.";
          const stats = await api<OrgStats>(
            `/orgs/${org.id}/stats${statsQuery(parsed.output.days)}`,
            {
              signal,
            },
          );
          await navigate({ to: "/analytics" });
          return analyticsSummary(stats, parsed.output.focus ?? "overview");
        },
      },
    ];

    return registerWebMcpTools(tools);
  }, [currentUser.data, navigate, org]);

  return null;
}
