import { useState } from "react";
import { useStats, useCurrentUser, useClickUsage } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { clicksByWeekday } from "../lib/click-buckets";
import { PLAN_LIMITS, type HeatmapRow, type OrgStats, type UserOrg } from "@/shared/types";
import { AreaChart, BarList, ClicksByHour, StatsChart } from "../components/charts";
import { CountryMap } from "../components/country-map";
import { PanelTabs } from "../ui/tabs";
import { Segmented } from "../ui/segmented";
import { formatNumber } from "../lib/numbers";
import { AnalyticsSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { ClickCapBanner } from "../components/over-limit";
import { ExportCsvButton } from "../components/export-csv-button";
import { PageHeader, SlugLink } from "../ui/misc";
import { Tooltip } from "../ui/tooltip";
import { HrefLink } from "../lib/router-search";

const RANGE_PRESETS: {
  label: string;
  days: number;
  bucket?: "hour";
}[] = [
  { label: "24h", days: 1, bucket: "hour" },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "365d", days: 365 },
];

/** "1-hour" or "30-day": one id per preset, for the segmented control. */
const presetId = (p: { days: number; bucket?: "hour" }) => `${p.days}-${p.bucket ?? "day"}`;

function RangePicker({
  presets,
  hiddenRanges,
  activeDays,
  activeBucket,
  onChoose,
}: {
  presets: typeof RANGE_PRESETS;
  /** The windows this plan cannot reach, named so the picker can say the
      history is hidden rather than missing (#163). */
  hiddenRanges: string[];
  activeDays: number;
  activeBucket: "day" | "hour";
  onChoose: (days: number, bucket?: "day" | "hour") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Segmented
        label="Range"
        items={presets.map((p) => ({ id: presetId(p), label: p.label }))}
        value={`${activeDays}-${activeBucket}`}
        onChange={(id) => {
          const p = presets.find((x) => presetId(x) === id);
          if (p) onChoose(p.days, p.bucket);
        }}
      />
      {hiddenRanges.length > 0 && (
        <Tooltip
          content={`Clicks are kept for 400 days. ${hiddenRanges.join(" and ")} come back the moment you upgrade, nothing was deleted.`}
        >
          <HrefLink href="/billing" className="text-xs text-muted hover:text-text">
            Upgrade for {hiddenRanges[hiddenRanges.length - 1]}
          </HrefLink>
        </Tooltip>
      )}
    </div>
  );
}

/** "Oct 5" from "2026-10-05", and "14:00" from an hourly bucket. */
const dayTick = (day: string) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const hourTick = (day: string) => day.slice(11, 16);

const COUNTRY_NAMES = new Intl.DisplayNames("en", { type: "region" });
function countryName(code: string): string {
  try {
    return COUNTRY_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Where clicks came from: referrers, then whichever UTM lists have rows. A
 * UTM tab with nothing in it is noise to an org that does not tag links. */
function SourcesPanel({ s, period }: { s: OrgStats; period?: string }) {
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
              empty="Where people were when they followed a link appears here."
            />
          ),
        },
        ...utm.map((g) => ({
          value: g.value,
          label: g.label,
          panel: <BarList head={[g.label.slice(0, -1), "Clicks"]} items={g.items} />,
        })),
      ]}
    />
  );
}

function LinksPanel({ s }: { s: OrgStats }) {
  const linkList = (
    rows: { id: string; slug: string; title: string; suffix: string }[],
    empty: string,
  ) =>
    rows.length ? (
      <ul className="flex flex-col">
        {rows.map((l) => (
          <li key={l.id} className="flex h-9 items-center justify-between gap-3 text-sm">
            <SlugLink to={`/links/${l.slug}`} slug={l.slug} title={l.title} />
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
              items={s.topLinks.map((l) => ({ key: l.slug, clicks: l.clicks }))}
              formatKey={(slug) => {
                const link = s.topLinks.find((l) => l.slug === slug);
                return (
                  <HrefLink href={`/links/${slug}`} className="hover:underline">
                    {link?.title || `/${slug}`}
                  </HrefLink>
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

function PlacesPanel({ s, period }: { s: OrgStats; period?: string }) {
  return (
    <PanelTabs
      end={period}
      tabs={[
        {
          value: "countries",
          label: "Countries",
          panel: (
            <BarList
              head={["Country", "Clicks"]}
              items={s.countries.map((c) => ({ ...c, key: countryName(c.key) }))}
              empty="The country each click came from appears here. Never the address it came from."
            />
          ),
        },
        { value: "map", label: "Map", panel: <CountryMap countries={s.countries} /> },
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

type AnalyticsRange = { days?: number; bucket?: "day" | "hour" };

/** The period the breakdown cards name, when it differs from the heading's.
 * The 24-hour view's chart and totals cover the last 24 hours, but its
 * breakdowns read the daily rollups, so they cover today's UTC day. The
 * heatmap is hidden in that view (see ActivityBreakdown). */
function breakdownPeriod(bucket: "day" | "hour"): string | undefined {
  return bucket === "hour" ? "Today (UTC)" : undefined;
}

function AnalyticsReport({
  stats: s,
  maxDays,
  range,
  onRangeChange,
}: {
  stats: OrgStats;
  maxDays: number;
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
}) {
  const presets = RANGE_PRESETS.filter((p) => p.days <= maxDays);
  const hiddenRanges = RANGE_PRESETS.filter((p) => p.days > maxDays).map((p) => p.label);
  const activeDays = range.days ?? s.rangeDays;
  const activeBucket = range.bucket ?? s.bucket;
  const chooseRange = (days: number, bucket?: "day" | "hour") => {
    if (days === s.rangeDays && (bucket ?? "day") === s.bucket) {
      onRangeChange({});
    } else {
      onRangeChange({ days, bucket });
    }
  };

  const period = breakdownPeriod(s.bucket);

  const hourly = s.bucket === "hour";
  return (
    <div>
      <PageHeader
        title="Analytics"
        sub={`All links · ${hourly ? "last 24 hours" : `last ${s.rangeDays} days`}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RangePicker
              presets={presets}
              hiddenRanges={hiddenRanges}
              activeDays={activeDays}
              activeBucket={activeBucket}
              onChoose={chooseRange}
            />
            <ExportCsvButton stats={s} scope="analytics" days={activeDays} />
          </div>
        }
      />
      <ClickCapBanner />
      <div className="flex flex-col gap-6">
        <StatsChart
          figures={[
            {
              label: "Total clicks",
              value: formatNumber(s.totalClicks),
              delta: s.totalClicksDelta,
            },
            { label: "Clicks · 7d", value: formatNumber(s.clicks7d), delta: s.clicks7dDelta },
            { label: "Active links", value: formatNumber(s.totalLinks) },
            {
              label: "Top country",
              value: s.countries[0] ? countryName(s.countries[0].key) : "None yet",
            },
          ]}
        >
          <AreaChart
            data={hourly ? s.hourSeries : s.series}
            tickFormat={hourly ? hourTick : dayTick}
          />
        </StatsChart>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <LinksPanel s={s} />
          <SourcesPanel s={s} period={period} />
          <PlacesPanel s={s} period={period} />
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

function AnalyticsForOrg({ org }: { org: UserOrg }) {
  const [range, setRange] = useState<AnalyticsRange>({});
  const stats = useStats(org.id, range.days, range.bucket);
  // Fetched with the stats so the cap banner is there when the page draws.
  useClickUsage(org.id);

  if (stats.isLoading) return <AnalyticsSkeleton />;
  if (!stats.data) return <p className="text-sm text-danger">Could not load stats.</p>;
  return (
    <AnalyticsReport
      stats={stats.data}
      maxDays={PLAN_LIMITS[org.plan].analyticsDays}
      range={range}
      onRangeChange={setRange}
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
