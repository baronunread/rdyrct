import { useState } from "react";
import { useStats } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS, type HeatmapRow, type SeriesPoint } from "@/shared/types";
import {
  AreaChart,
  BarList,
  StatCard,
  Heatmap,
  LinkListCard,
  ClickBreakdown,
  TopLinksCard,
} from "../components/charts";
import { AnalyticsSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { Card, PageHeader } from "../ui/misc";

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

function RangePicker({
  presets,
  activeDays,
  activeBucket,
  onChoose,
}: {
  presets: typeof RANGE_PRESETS;
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
          className={`cursor-pointer rounded-md px-2 py-1 text-xs transition-colors ${
            activeDays === p.days && activeBucket === (p.bucket ?? "day")
              ? "bg-accent text-bg"
              : "text-muted hover:bg-surface-2 hover:text-text"
          }`}
        >
          {p.label}
        </button>
      ))}
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
  if (!campaigns.length && !sources.length && !mediums.length) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {campaigns.length > 0 && (
        <Card>
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Campaigns</p>
          <BarList items={campaigns.map((c) => ({ key: c.campaign, clicks: c.clicks }))} />
        </Card>
      )}
      {sources.length > 0 && (
        <Card>
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Sources</p>
          <BarList items={sources.map((x) => ({ key: x.source, clicks: x.clicks }))} />
        </Card>
      )}
      {mediums.length > 0 && (
        <Card>
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Mediums</p>
          <BarList items={mediums.map((x) => ({ key: x.medium, clicks: x.clicks }))} />
        </Card>
      )}
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
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
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
 * a day-of-week/hour heatmap to be meaningful. */
function ActivityHeatmap({ heatmap, bucket }: { heatmap: HeatmapRow[]; bucket: "day" | "hour" }) {
  if (!heatmap.length || bucket === "hour") return null;
  return (
    <Card className="mt-4">
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Activity heatmap</p>
      <Heatmap data={heatmap} />
    </Card>
  );
}

export function Analytics() {
  const { org } = useCurrentOrg();
  const [range, setRange] = useState<{ days?: number; bucket?: "day" | "hour" }>({});
  const stats = useStats(org?.id ?? "", range.days, range.bucket);

  if (!org) return <NoOrgState />;
  if (stats.isLoading) return <AnalyticsSkeleton />;
  if (!stats.data) return <p className="text-sm text-danger">Could not load stats.</p>;
  const s = stats.data;
  const maxDays = PLAN_LIMITS[org.plan].analyticsDays;
  const presets = RANGE_PRESETS.filter((p) => p.days <= maxDays);
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
          <RangePicker
            presets={presets}
            activeDays={activeDays}
            activeBucket={activeBucket}
            onChoose={chooseRange}
          />
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total clicks" value={s.totalClicks} delta={s.totalClicksDelta} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} delta={s.clicks7dDelta} />
        <StatCard label="Active links" value={s.totalLinks} />
      </div>

      <ClicksChart bucket={s.bucket} series={s.series} hourSeries={s.hourSeries} />

      <UtmBreakdownSection campaigns={s.campaigns} sources={s.sources} mediums={s.mediums} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopLinksCard topLinks={s.topLinks} />
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

      <ActivityHeatmap heatmap={s.heatmap} bucket={s.bucket} />
    </div>
  );
}
