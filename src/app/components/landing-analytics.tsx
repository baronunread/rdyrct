import { useMemo, useState } from "react";
import type { HeatmapRow, SeriesPoint } from "@/shared/types";
import { AreaChart, BarList, Heatmap } from "./charts";

// Deterministic pseudo-random generator (LCG): the mock data is identical on
// every visit, so the demo never looks stale or jumps between renders.
function lcg(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/** Daily clicks with a weekly rhythm and a gentle upward trend. */
function dailyClicks(days: number, base: number, growth: number, seed: number): number[] {
  const rand = lcg(seed);
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const weekly = 1 + 0.3 * Math.sin(((i % 7) / 7) * Math.PI * 2);
    const trend = 1 + (growth * i) / days;
    out.push(Math.max(1, Math.round(base * weekly * trend * (0.7 + rand() * 0.6))));
  }
  return out;
}

/** Date-labeled points ending today, mirroring the real stats payload. */
function toDailyPoints(values: number[]): SeriesPoint[] {
  const now = Date.now();
  return values.map((clicks, i) => ({
    day: new Date(now - (values.length - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    clicks,
  }));
}

/** The last 24 hours, labeled like the real hourly buckets ("… 14:00"). */
function hourlyPoints(): SeriesPoint[] {
  const rand = lcg(7);
  const hourMs = 3_600_000;
  const start = Math.floor((Date.now() - 23 * hourMs) / hourMs) * hourMs;
  return Array.from({ length: 24 }, (_, i) => {
    const d = new Date(start + i * hourMs);
    const hour = Number(d.toISOString().slice(11, 13));
    const business = hour >= 8 && hour <= 19;
    const base = business ? 42 : 8;
    return {
      day: `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 13)}:00`,
      clicks: Math.round(base * (0.6 + rand() * 0.8)),
    };
  });
}

/** Weekday-business-hours heatmap, like a small B2B audience would produce. */
function heatmapData(): HeatmapRow[] {
  const rand = lcg(99);
  const rows: HeatmapRow[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const business = d < 5 && h >= 8 && h <= 18;
      const evening = h >= 19 && h <= 22;
      const base = business ? 26 : evening ? 14 : 3;
      rows.push({ dayOfWeek: d, hour: h, clicks: Math.round(base * (0.5 + rand())) });
    }
  }
  return rows;
}

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

function StatTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: number;
  delta?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <p className="truncate text-2xs tracking-wider text-muted uppercase">{label}</p>
      <p className="tnum mt-1 text-xl font-bold">{value.toLocaleString()}</p>
      {delta != null && delta !== 0 && (
        <span
          className={`tnum mt-1 inline-block text-xs ${
            delta > 0 ? "text-accent-2" : "text-danger"
          }`}
        >
          {delta > 0 ? "+" : ""}
          {delta}%
        </span>
      )}
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
    <div className="w-full max-w-4xl rounded-2xl border border-border bg-surface shadow-2xl shadow-black/10">
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
          <div className="flex items-center gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                aria-pressed={range === r.label}
                onClick={() => setRange(r.label)}
                className={`cursor-pointer rounded-md px-2 py-1 text-xs transition-colors ${
                  range === r.label
                    ? "bg-accent text-bg"
                    : "text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
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
            tickFormat={
              active.bucket === "hour" ? (day) => day.slice(11, 16) : undefined
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-bg/40 p-4">
            <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
              Campaigns
            </p>
            <BarList items={CAMPAIGNS} />
          </div>
          <div className="rounded-lg border border-border bg-bg/40 p-4">
            <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
              Countries
            </p>
            <BarList items={COUNTRIES} />
          </div>
          <div className="rounded-lg border border-border bg-bg/40 p-4">
            <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
              Devices
            </p>
            <BarList items={DEVICES} />
          </div>
        </div>

        {active.bucket !== "hour" && (
          <div className="rounded-lg border border-border bg-bg/40 p-4">
            <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
              Activity heatmap
            </p>
            <Heatmap data={HEATMAP} />
          </div>
        )}
      </div>
    </div>
  );
}
