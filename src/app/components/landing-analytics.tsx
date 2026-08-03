import { useMemo, useState } from "react";
import type { SeriesPoint } from "@/shared/types";
import { AreaChart, BarList, Heatmap } from "./charts";
import { dailyClicks, toDailyPoints, hourlyPoints, heatmapData } from "../lib/landing-mock-data";

const RANGES = [
  { label: "24h", days: 1, bucket: "hour" },
  { label: "7d", days: 7, bucket: "day" },
  { label: "30d", days: 30, bucket: "day" },
  { label: "365d", days: 365, bucket: "day" },
] as const;

const DAILY_30 = dailyClicks(30, 95, 0.8, 42);
const SERIES: Record<(typeof RANGES)[number]["label"], SeriesPoint[]> = {
  "24h": hourlyPoints(),
  "7d": toDailyPoints(DAILY_30.slice(-7)),
  "30d": toDailyPoints(DAILY_30),
  "365d": toDailyPoints(dailyClicks(365, 60, 2.5, 7)),
};
const CLICKS_7D = DAILY_30.slice(-7).reduce((a, b) => a + b, 0);
const HEATMAP = heatmapData();

const CAMPAIGNS = [
  { key: "launch", clicks: 486 },
  { key: "spring-sale", clicks: 312 },
  { key: "newsletter", clicks: 208 },
  { key: "podcast", clicks: 121 },
];

const COUNTRIES = [
  { key: "United States", clicks: 412 },
  { key: "Germany", clicks: 231 },
  { key: "United Kingdom", clicks: 187 },
  { key: "Brazil", clicks: 143 },
  { key: "Japan", clicks: 98 },
];

const DEVICES = [
  { key: "Mobile", clicks: 741 },
  { key: "Desktop", clicks: 512 },
  { key: "Tablet", clicks: 90 },
];

function DeltaBadge({ delta }: { delta: number }) {
  return (
    <span
      className={`tnum mt-1 inline-block text-xs ${delta > 0 ? "text-accent-2" : "text-danger"}`}
    >
      {delta > 0 ? "+" : ""}
      {delta}%
    </span>
  );
}

function StatTile({ label, value, delta }: { label: string; value: number; delta?: number }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <p className="truncate text-2xs tracking-wider text-muted uppercase">{label}</p>
      <p className="tnum mt-1 text-xl font-bold">{value.toLocaleString()}</p>
      {delta != null && delta !== 0 && <DeltaBadge delta={delta} />}
    </div>
  );
}

function RangeTabs({
  active,
  onSelect,
}: {
  active: (typeof RANGES)[number]["label"];
  onSelect: (label: (typeof RANGES)[number]["label"]) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {RANGES.map((r) => (
        <button
          key={r.label}
          type="button"
          aria-pressed={active === r.label}
          onClick={() => onSelect(r.label)}
          className={`cursor-pointer rounded-md px-2 py-1 text-xs transition-colors ${
            active === r.label
              ? "bg-accent text-bg"
              : "text-muted hover:bg-surface-2 hover:text-text"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Analytics-page mockup for the landing page, built from the app's real chart
 * components (AreaChart + BarList + Heatmap) over demo data: theme-aware and
 * CSP-safe like everything else on the page. The range presets really switch
 * the series (hourly buckets for 24h, like the product), and the area chart's
 * hover crosshair works, so visitors can poke at it.
 */
export function LandingAnalyticsMock() {
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("30d");
  const active = RANGES.find((r) => r.label === range)!;
  const series = useMemo(() => SERIES[range], [range]);

  return (
    <div className="w-full max-w-4xl rounded-2xl bg-surface smooth-shadow-ring-2xl">
      {/* fake browser chrome, mirrors the hero mockup */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-4">
        <span className="h-3 w-3 rounded-full bg-pink/60" />
        <span className="h-3 w-3 rounded-full bg-butter/60" />
        <span className="h-3 w-3 rounded-full bg-mint/60" />
        <span className="ml-3 flex-1 truncate rounded-md bg-surface-2 px-3 py-1.5 text-xs text-muted">
          rdyrct.com/analytics
        </span>
      </div>

      <div className="flex flex-col gap-4 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-bold">Analytics</p>
            <p className="text-xs text-muted">
              {active.bucket === "hour" ? "Last 24 hours" : `Last ${active.days} days`}
            </p>
          </div>
          <RangeTabs active={range} onSelect={setRange} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Total clicks" value={8412} delta={18} />
          <StatTile label="Clicks · 7d" value={CLICKS_7D} delta={12} />
          <StatTile label="Active links" value={12} />
        </div>

        <div className="rounded-lg border border-border bg-bg/40 p-4">
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
            {active.bucket === "hour" ? "Clicks per hour" : "Clicks per day"}
          </p>
          <AreaChart
            data={series}
            height={160}
            tickFormat={active.bucket === "hour" ? (day) => day.slice(11, 16) : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-bg/40 p-4">
            <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Campaigns</p>
            <BarList items={CAMPAIGNS} />
          </div>
          <div className="rounded-lg border border-border bg-bg/40 p-4">
            <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Countries</p>
            <BarList items={COUNTRIES} />
          </div>
          <div className="rounded-lg border border-border bg-bg/40 p-4">
            <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Devices</p>
            <BarList items={DEVICES} />
          </div>
        </div>

        {active.bucket !== "hour" && (
          <div className="rounded-lg border border-border bg-bg/40 p-4">
            <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Activity heatmap</p>
            <Heatmap data={HEATMAP} />
          </div>
        )}
      </div>
    </div>
  );
}
