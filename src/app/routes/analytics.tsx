import { useState } from "react";
import { useStats } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS } from "@/shared/types";
import {
  AreaChart,
  BarList,
  StatCard,
  Heatmap,
  LinkListCard,
  ClickBreakdown,
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

      <Card className="mt-4">
        <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
          {s.bucket === "hour" ? "Clicks per hour" : "Clicks per day"}
        </p>
        <AreaChart
          data={s.bucket === "hour" ? s.hourSeries : s.series}
          tickFormat={s.bucket === "hour" ? (day) => day.slice(11, 16) : undefined}
        />
      </Card>

      <UtmBreakdownSection campaigns={s.campaigns} sources={s.sources} mediums={s.mediums} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Top links</p>
          {s.topLinks.length ? (
            <BarList
              items={s.topLinks.map((l) => ({
                key: `/${l.slug}${l.title ? ` · ${l.title}` : ""}`,
                clicks: l.clicks,
              }))}
            />
          ) : (
            <p className="py-4 text-sm text-muted">No data yet</p>
          )}
        </Card>
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

      {s.heatmap.length > 0 && s.bucket !== "hour" && (
        <Card className="mt-4">
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Activity heatmap</p>
          <Heatmap data={s.heatmap} />
        </Card>
      )}
    </div>
  );
}
