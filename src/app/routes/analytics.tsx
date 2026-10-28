import { useState } from "react";
import { settle } from "../lib/route-preload";
import { IconChartLine } from "@tabler/icons-react";
import type { QueryClient } from "@tanstack/react-query";
import { clickUsageQuery, linksQuery, useCurrentUser, useClickUsage, useLinks } from "../lib/hooks";
import { canWriteOrg } from "../lib/org-limits";
import { NewLinkButton, useNewLink } from "../components/new-link-host";
import { useCurrentOrg } from "../lib/current-org";
import { clicksByWeekday } from "../lib/click-buckets";
import { PLAN_LIMITS, type HeatmapRow, type StatsLinkRef, type UserOrg } from "@/shared/types";
import {
  AreaChart,
  BarList,
  ClicksByHour,
  LinkBarLabel,
  PlacesPanel,
  StatsChart,
  dayTick,
  hourTick,
  linkPagePath,
  type ChartFigure,
} from "../components/charts";
import { RangeControl } from "../components/range-control";
import { SourceTile } from "../components/source-tile";
import { PanelTabs } from "../ui/tabs";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { useToast } from "../ui/toast";
import { formatNumber } from "../lib/numbers";
import { copyToClipboard } from "../lib/clipboard";
import { linkDisplayTitle } from "../lib/link-display";
import { AnalyticsSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { ClickCapBanner } from "../components/over-limit";
import { ExportCsvButton } from "../components/export-csv-button";
import { PageHeader, SlugLink } from "../ui/misc";
import {
  PRESET_24H,
  PRESET_30D,
  PRESET_365D,
  PRESET_7D,
  cappedCount,
  clicksPerLink,
  deviceLabel,
  sourceLabel,
  insightStatsQuery,
  useInsightStats,
  type InsightStats,
  type RangePreset,
} from "../lib/insights-data";

const RANGE_PRESETS = [PRESET_24H, PRESET_7D, PRESET_30D, PRESET_365D] as const;

/** The newest link, for "Copy your newest link". */
const NEWEST_LINK = { limit: 1 };

/** Everything Analytics' first frame reads (see lib/route-preload.ts). No
 * range: the API answers with the plan's default, as the page asks it to. */
export function preload(qc: QueryClient, orgId: string) {
  const stats = qc.ensureQueryData(insightStatsQuery(orgId)).then(async (s) => {
    // The empty state offers the newest link, when there is one.
    if (!s.everClicked && s.totalLinks > 0)
      await qc.ensureQueryData(linksQuery(orgId, NEWEST_LINK));
  });
  return settle([stats, qc.ensureQueryData(clickUsageQuery(orgId))]);
}

/** Rows a breakdown card shows before "Show all N". */
const CARD_ROWS = 7;

/** Where clicks came from: referrers, then whichever UTM lists have rows. A
 * UTM tab with nothing in it is noise to an org that does not tag links. */
function SourcesPanel({ s, period }: { s: InsightStats; period?: string }) {
  const utm = [
    {
      value: "campaigns",
      label: "Campaigns",
      items: s.campaigns.map((c) => ({ key: c.campaign, clicks: c.clicks })),
    },
    {
      value: "sources",
      label: "Sources",
      items: s.sources.map((x) => ({ key: x.source, clicks: x.clicks })),
    },
    {
      value: "mediums",
      label: "Mediums",
      items: s.mediums.map((x) => ({ key: x.medium, clicks: x.clicks })),
    },
  ].filter((g) => g.items.length > 0);
  return (
    <PanelTabs
      end={period}
      tabs={[
        {
          value: "referrers",
          label: "Referrers",
          panel: (
            <BarList
              head={["Source", "Clicks"]}
              items={s.referrers}
              formatKey={sourceLabel}
              lead={(key) => <SourceTile source={key} />}
              limit={CARD_ROWS}
              empty="Where people were when they followed a link appears here."
            />
          ),
        },
        ...utm.map((g) => ({
          value: g.value,
          label: g.label,
          panel: (
            <BarList head={[g.label.slice(0, -1), "Clicks"]} items={g.items} limit={CARD_ROWS} />
          ),
        })),
      ]}
    />
  );
}

function LinksPanel({ s }: { s: InsightStats }) {
  const linkList = (rows: (StatsLinkRef & { suffix: string })[], empty: string) =>
    rows.length ? (
      <ul className="flex flex-col">
        {rows.map((l) => (
          <li
            key={l.id}
            className="flex h-8 items-center justify-between gap-3 text-sm [&+&]:shadow-[inset_0_1px_0_var(--border)]"
          >
            <SlugLink to={linkPagePath(l)} slug={l.slug} title={l.title} />
            <span className="tnum shrink-0 text-xs text-muted">{l.suffix}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="py-2 text-sm text-pretty text-muted">{empty}</p>
    );
  return (
    <PanelTabs
      tabs={[
        {
          value: "top",
          label: "Top links",
          panel: (
            <BarList
              head={["Link", "Clicks"]}
              empty="Your busiest links appear here once they start collecting clicks."
              items={s.topLinks.map((l) => ({ key: l.id, clicks: l.clicks }))}
              limit={CARD_ROWS}
              formatKey={(id) => {
                const link = s.topLinks.find((l) => l.id === id);
                return link ? (
                  <LinkBarLabel slug={link.slug} title={link.title} domain={link.domain} />
                ) : (
                  id
                );
              }}
            />
          ),
        },
        {
          value: "decaying",
          label: "Decaying",
          panel: linkList(
            s.decayingLinks.map((l) => ({ ...l, suffix: `${l.drop}% fewer clicks` })),
            "No link lost half its clicks this week.",
          ),
        },
        {
          value: "dead",
          label: "Dead",
          panel: linkList(
            s.deadLinks.map((l) => ({ ...l, suffix: "No clicks in 30 days" })),
            "Every link had a click in the last 30 days.",
          ),
        },
      ]}
    />
  );
}

/** Only for daily buckets: an hourly range is too short for a by-hour and
 * by-weekday breakdown to mean anything. */
function TimingPanel({ heatmap }: { heatmap: HeatmapRow[] }) {
  return (
    <PanelTabs
      tabs={[
        { value: "hour", label: "By hour", panel: <ClicksByHour data={heatmap} /> },
        {
          value: "weekday",
          label: "By weekday",
          // clicksByWeekday always returns all seven days.
          panel: <BarList head={["Day", "Clicks"]} items={clicksByWeekday(heatmap)} />,
        },
      ]}
    />
  );
}

/** The period the breakdown cards name, when it differs from the heading's.
 * The 24-hour view's chart and totals cover the last 24 hours, but its
 * breakdowns read the daily rollups, so they cover today's UTC day. The
 * heatmap is hidden in that view. */
function breakdownPeriod(bucket: "day" | "hour"): string | undefined {
  return bucket === "hour" ? "Today (UTC)" : undefined;
}

/** The figures over the chart. "Links clicked" and "Clicks per link" need a
 * count the API does not send yet: until it does, the strip shows how many
 * links there are, and leaves out the figure it cannot work out. */
function analyticsFigures(s: InsightStats): ChartFigure[] {
  const perLink = clicksPerLink(s);
  return [
    { label: "Clicks", value: formatNumber(s.totalClicks), delta: s.totalClicksDelta },
    s.linksClicked !== undefined
      ? {
          label: "Links clicked",
          value: formatNumber(s.linksClicked),
          delta: s.linksClickedDelta ?? null,
        }
      : { label: "Links", value: formatNumber(s.totalLinks) },
    {
      label: "Countries",
      value: cappedCount(s.countryCount, s.countries.filter((c) => c.key !== "unknown").length, 10),
    },
    ...(perLink
      ? [{ label: "Clicks per link", value: formatNumber(perLink.value), delta: perLink.delta }]
      : []),
  ];
}

function rangeSub(s: InsightStats) {
  return `All links · ${s.bucket === "hour" ? "last 24 hours" : `last ${s.rangeDays} days`}`;
}

function AnalyticsReport({
  stats: s,
  maxDays,
  range,
  onRangeChange,
  updating,
}: {
  stats: InsightStats;
  maxDays: number;
  range: RangePreset | null;
  onRangeChange: (range: RangePreset) => void;
  /** The figures below are the last range's, while the new one loads. */
  updating: boolean;
}) {
  const period = breakdownPeriod(s.bucket);
  const hourly = s.bucket === "hour";
  return (
    <div>
      <PageHeader
        title="Analytics"
        sub={rangeSub(s)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RangeControl
              presets={RANGE_PRESETS}
              maxDays={maxDays}
              days={range?.days ?? s.rangeDays}
              bucket={range ? (range.bucket ?? "day") : s.bucket}
              onChange={onRangeChange}
            />
            <ExportCsvButton stats={s} scope="analytics" days={range?.days ?? s.rangeDays} />
          </div>
        }
      />
      <ClickCapBanner />
      <div
        aria-busy={updating}
        className={cn(
          "flex flex-col gap-6 transition-opacity duration-200 ease-out",
          updating && "opacity-60",
        )}
      >
        <StatsChart figures={analyticsFigures(s)}>
          <div key={`${s.rangeDays}-${s.bucket}`} className="chart-in">
            <AreaChart
              data={hourly ? s.hourSeries : s.series}
              tickFormat={hourly ? hourTick : dayTick}
            />
          </div>
        </StatsChart>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <LinksPanel s={s} />
          <SourcesPanel s={s} period={period} />
          <PlacesPanel countries={s.countries} period={period} limit={CARD_ROWS} />
          <PanelTabs
            end={period}
            tabs={[
              {
                value: "devices",
                label: "Devices",
                panel: (
                  <BarList
                    head={["Device", "Clicks"]}
                    items={s.devices}
                    formatKey={deviceLabel}
                    empty="Phone, desktop or tablet, counted here once clicks arrive."
                  />
                ),
              },
            ]}
          />
        </div>

        {!hourly && s.heatmap.length > 0 && <TimingPanel heatmap={s.heatmap} />}
      </div>
    </div>
  );
}

/** A faint line where the chart will be: the shape of what is coming, drawn
 * in the border colour so nobody mistakes it for data. */
function GhostChart() {
  return (
    <svg
      viewBox="0 0 520 90"
      aria-hidden
      className="h-20 w-full max-w-[440px]"
      preserveAspectRatio="none"
    >
      <path
        d="M0,70 C26.7,66 53.3,58 80,58 C106.7,58 133.3,66 160,64 C186.7,62 213.3,40 240,40 C266.7,40 293.3,50 320,48 C346.7,46 373.3,22 400,22 C440,22 480,30 520,30"
        fill="none"
        stroke="var(--border)"
        strokeWidth="2.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <line x1="0" x2="520" y1="88" y2="88" stroke="var(--border)" strokeOpacity="0.6" />
    </svg>
  );
}

/** The one action for an org that has links but no clicks: the newest link,
 * on the clipboard, ready to share. */
function CopyNewestLink({ orgId }: { orgId: string }) {
  const toast = useToast();
  const newest = useLinks(orgId, NEWEST_LINK).data?.items[0];
  if (!newest) return null;
  return (
    <Button
      variant="outline"
      onClick={() =>
        void copyToClipboard(newest.url, toast, {
          success: `Copied ${linkDisplayTitle(newest.url)}`,
        }).catch(() => undefined)
      }
    >
      Copy your newest link
    </Button>
  );
}

/**
 * Nothing has been clicked yet: one card that says what will appear and
 * offers one action, rather than ten panels each saying "nothing yet" in
 * its own words. With links, the action is sharing the newest; without,
 * making one.
 */
function NoClicksYet({
  org,
  stats: s,
  hasLinks,
  range,
  onRangeChange,
}: {
  org: UserOrg;
  stats: InsightStats;
  hasLinks: boolean;
  range: RangePreset | null;
  onRangeChange: (range: RangePreset) => void;
}) {
  const { openNewLink } = useNewLink();
  const canWrite = canWriteOrg(org.role, org.locked);
  return (
    <div>
      <PageHeader
        title="Analytics"
        sub={rangeSub(s)}
        action={
          <RangeControl
            presets={RANGE_PRESETS}
            maxDays={PLAN_LIMITS[org.plan].analyticsDays}
            days={range?.days ?? s.rangeDays}
            bucket={range ? (range.bucket ?? "day") : s.bucket}
            onChange={onRangeChange}
          />
        }
      />
      <div className="flex flex-col items-center gap-2.5 rounded-xl px-4 py-9 text-center smooth-shadow-ring-xs sm:px-6 sm:py-12">
        <GhostChart />
        <span className="grid size-11 place-items-center rounded-xl bg-bg text-muted">
          <IconChartLine size={20} stroke={1.75} aria-hidden />
        </span>
        <h2 className="text-base font-semibold">No clicks yet</h2>
        <p className="max-w-[44ch] text-sm text-pretty text-muted">
          Clicks per day, top links, countries, sources and devices appear here once someone follows
          one of your links.
        </p>
        <div className="mt-1">
          {hasLinks ? (
            <CopyNewestLink orgId={org.id} />
          ) : (
            canWrite && <NewLinkButton onClick={openNewLink} />
          )}
        </div>
      </div>
    </div>
  );
}

function AnalyticsForOrg({ org }: { org: UserOrg }) {
  // Null until somebody picks: the API answers with the plan's default.
  const [range, setRange] = useState<RangePreset | null>(null);
  const stats = useInsightStats(org.id, range?.days, range?.bucket);
  // Fetched with the stats so the cap banner is there when the page draws.
  useClickUsage(org.id);

  if (stats.isLoading) return <AnalyticsSkeleton />;
  if (!stats.data) return <p className="text-sm text-danger">Could not load stats.</p>;
  if (!stats.data.everClicked)
    return (
      <NoClicksYet
        org={org}
        stats={stats.data}
        hasLinks={stats.data.totalLinks > 0}
        range={range}
        onRangeChange={setRange}
      />
    );
  return (
    <AnalyticsReport
      stats={stats.data}
      maxDays={PLAN_LIMITS[org.plan].analyticsDays}
      range={range}
      onRangeChange={setRange}
      updating={stats.isPlaceholderData}
    />
  );
}

export function Analytics() {
  const { org } = useCurrentOrg();
  const currentUser = useCurrentUser();

  if (currentUser.isLoading) return <AnalyticsSkeleton />;
  if (!org) return <NoOrgState />;
  return <AnalyticsForOrg org={org} />;
}
