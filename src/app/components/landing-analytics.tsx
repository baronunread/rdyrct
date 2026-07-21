import { useMemo } from "react";
import { AreaChart, BarList } from "./charts";

// A believable fortnight of clicks for a small campaign; the day labels are
// derived from "today" so the mock never looks stale.
const CLICKS = [42, 58, 51, 73, 66, 89, 94, 81, 112, 105, 131, 124, 149, 168];
const CLICKS_14D = CLICKS.reduce((a, b) => a + b, 0);

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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <p className="text-2xs tracking-wider text-muted uppercase">{label}</p>
      <p className="tnum mt-1 text-xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}

/**
 * Dashboard mockup for the landing page, built from the app's real chart
 * components (AreaChart + BarList) over demo data — theme-aware and CSP-safe
 * like everything else on the page. The area chart's hover crosshair works,
 * so visitors can poke at it.
 */
export function LandingAnalyticsMock() {
  const series = useMemo(() => {
    const now = Date.now();
    return CLICKS.map((clicks, i) => ({
      day: new Date(now - (CLICKS.length - 1 - i) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      clicks,
    }));
  }, []);

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
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Total clicks" value={8412} />
          <StatTile label="Clicks · 14d" value={CLICKS_14D} />
          <StatTile label="Active links" value={12} />
        </div>

        <div className="rounded-lg border border-border bg-bg/40 p-4">
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
            Clicks per day
          </p>
          <AreaChart data={series} height={160} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      </div>
    </div>
  );
}
