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
          <div className="flex items-center gap-1.5">
            {presets.map((p) => (
              <button
                key={`${p.days}-${p.bucket ?? "day"}`}
                type="button"
                onClick={() => chooseRange(p.days, p.bucket)}
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

      {(s.campaigns.length > 0 || s.sources.length > 0 || s.mediums.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {s.campaigns.length > 0 && (
            <Card>
              <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Campaigns</p>
              <BarList
                items={s.campaigns.map((c) => ({
                  key: c.campaign,
                  clicks: c.clicks,
                }))}
              />
            </Card>
          )}
          {s.sources.length > 0 && (
            <Card>
              <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Sources</p>
              <BarList
                items={s.sources.map((x) => ({
                  key: x.source,
                  clicks: x.clicks,
                }))}
              />
            </Card>
          )}
          {s.mediums.length > 0 && (
            <Card>
              <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Mediums</p>
              <BarList
                items={s.mediums.map((x) => ({
                  key: x.medium,
                  clicks: x.clicks,
                }))}
              />
            </Card>
          )}
        </div>
      )}

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
