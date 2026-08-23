import { useState } from "react";
import { useStats, useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { clicksByWeekday } from "../lib/click-buckets";
import { PLAN_LIMITS, type HeatmapRow, type SeriesPoint } from "@/shared/types";
import {
  AreaChart,
  BarList,
  StatCard,
  ClicksByHour,
  LinkListCard,
  ClickBreakdown,
  TopLinksCard,
} from "../components/charts";
import { AnalyticsSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { ExportCsvButton } from "../components/export-csv-button";
import { Card, PageHeader } from "../ui/misc";
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

function rangeButtonClass(active: boolean): string {
  return `cursor-pointer rounded-md px-2 py-1 text-xs transition-colors ${
    active ? "bg-accent text-bg" : "text-muted hover:bg-surface-2 hover:text-text"
  }`;
}

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
    <div className="flex items-center gap-1.5">
      {presets.map((p) => (
        <button
          key={`${p.days}-${p.bucket ?? "day"}`}
          type="button"
          onClick={() => onChoose(p.days, p.bucket)}
          className={rangeButtonClass(
            activeDays === p.days && activeBucket === (p.bucket ?? "day"),
          )}
        >
          {p.label}
        </button>
      ))}
      {hiddenRanges.length > 0 && (
        <Tooltip
          content={`Clicks are kept for 400 days. ${hiddenRanges.join(" and ")} come back the moment you upgrade, nothing was deleted.`}
        >
          <HrefLink href="/billing" className={rangeButtonClass(false)}>
            Upgrade for {hiddenRanges[hiddenRanges.length - 1]}
          </HrefLink>
        </Tooltip>
      )}
    </div>
  );
}

function UtmBreakdownSection({
  campaigns,
  sources,
  mediums,
}: {
  campaigns: { campaign: string; clicks: number }[];
  sources: { source: string; clicks: number }[];
  mediums: { medium: string; clicks: number }[];
}) {
  const groups = [
    { label: "Campaigns", items: campaigns.map((c) => ({ key: c.campaign, clicks: c.clicks })) },
    { label: "Sources", items: sources.map((x) => ({ key: x.source, clicks: x.clicks })) },
    { label: "Mediums", items: mediums.map((x) => ({ key: x.medium, clicks: x.clicks })) },
  ].filter((g) => g.items.length > 0);

  if (!groups.length) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => (
        <Card key={g.label}>
          <p className="mb-3 text-xs font-medium text-muted">{g.label}</p>
          {/* No empty line: the filter above drops a group with no items,
              and the whole section goes when every group is empty. A card
              titled "Campaigns" saying "nothing yet" to an org that does not
              use UTM tags is noise, not help. */}
          <BarList items={g.items} />
        </Card>
      ))}
    </div>
  );
}

/** Clicks-over-time chart: switches between the hourly and daily series
 * (and their label/tick format) based on the active bucket. */
function ClicksChart({
  bucket,
  series,
  hourSeries,
}: {
  bucket: "day" | "hour";
  series: SeriesPoint[];
  hourSeries: SeriesPoint[];
}) {
  const isHourly = bucket === "hour";
  return (
    <Card className="mt-4">
      <p className="mb-3 text-xs font-medium text-muted">
        {isHourly ? "Clicks per hour" : "Clicks per day"}
      </p>
      <AreaChart
        data={isHourly ? hourSeries : series}
        tickFormat={isHourly ? (day) => day.slice(11, 16) : undefined}
      />
    </Card>
  );
}

/** Only shown for daily buckets with data: hourly ranges are too short for
 * a day-of-week/hour breakdown to be meaningful. */
function ActivityBreakdown({ heatmap, bucket }: { heatmap: HeatmapRow[]; bucket: "day" | "hour" }) {
  if (!heatmap.length || bucket === "hour") return null;
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <p className="mb-3 text-xs font-medium text-muted">By hour</p>
        <ClicksByHour data={heatmap} />
      </Card>
      <Card>
        <p className="mb-3 text-xs font-medium text-muted">By weekday</p>
        {/* clicksByWeekday always returns all seven days, and the section
            above returns null without a heatmap, so this list is never
            empty. */}
        <BarList items={clicksByWeekday(heatmap)} />
      </Card>
    </div>
  );
}

export function Analytics() {
  const { org } = useCurrentOrg();
  const currentUser = useCurrentUser();
  const [range, setRange] = useState<{ days?: number; bucket?: "day" | "hour" }>({});
  const stats = useStats(org?.id ?? "", range.days, range.bucket);

  if (currentUser.isLoading) return <AnalyticsSkeleton />;
  if (!org) return <NoOrgState />;
  if (stats.isLoading) return <AnalyticsSkeleton />;
  if (!stats.data) return <p className="text-sm text-danger">Could not load stats.</p>;
  const s = stats.data;
  const maxDays = PLAN_LIMITS[org.plan].analyticsDays;
  const presets = RANGE_PRESETS.filter((p) => p.days <= maxDays);
  const hiddenRanges = RANGE_PRESETS.filter((p) => p.days > maxDays).map((p) => p.label);
  const activeDays = range.days ?? s.rangeDays;
  const activeBucket = range.bucket ?? s.bucket;
  const chooseRange = (days: number, bucket?: "day" | "hour") => {
    if (days === s.rangeDays && (bucket ?? "day") === s.bucket) {
      setRange({});
    } else {
      setRange({ days, bucket });
    }
  };

  return (
    <div>
      <PageHeader
        title="Analytics"
        sub={s.bucket === "hour" ? "Last 24 hours" : `Last ${s.rangeDays} days`}
        action={
          <div className="flex items-center gap-2">
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total clicks" value={s.totalClicks} delta={s.totalClicksDelta} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} delta={s.clicks7dDelta} />
        <StatCard label="Active links" value={s.totalLinks} />
      </div>

      <ClicksChart bucket={s.bucket} series={s.series} hourSeries={s.hourSeries} />

      <UtmBreakdownSection campaigns={s.campaigns} sources={s.sources} mediums={s.mediums} />

      <div className="mt-4">
        <TopLinksCard topLinks={s.topLinks} />
      </div>

      <div className="mt-4">
        <ClickBreakdown countries={s.countries} referrers={s.referrers} devices={s.devices} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LinkListCard
          title="Dead links"
          links={s.deadLinks.map((l) => ({ ...l, suffix: "0 clicks in 30d" }))}
        />
        <LinkListCard
          title="Decaying links"
          links={s.decayingLinks.map((l) => ({ ...l, suffix: `${l.drop}% drop` }))}
        />
      </div>

      <ActivityBreakdown heatmap={s.heatmap} bucket={s.bucket} />
    </div>
  );
}
