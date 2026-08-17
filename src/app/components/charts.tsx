import { useMemo } from "react";
import type { ReactNode } from "react";
import { scaleLinear, scalePoint } from "d3-scale";
import { areaY, barY, defineChart, lineY, type ConfiguredScaleLike } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { scaleBand } from "@tanstack/charts/scales/band";
import { curveMonotoneX } from "d3-shape";
import { crosshair } from "@tanstack/charts/crosshair";
import { focusNearestX } from "@tanstack/charts/focus";
import { motion } from "@tanstack/charts/motion";
import { RendererChart } from "@tanstack/react-charts/tooltip";
import { followSpring, pointerTooltip } from "./chart-tooltip";
import { clicksByHour, HOURS } from "../lib/click-buckets";
import type { SeriesPoint, DeltaValue, HeatmapRow, TopEntry } from "@/shared/types";
import { formatNumber } from "../lib/numbers";
import { Card, SlugLink } from "../ui/misc";
import { CountryMap } from "./country-map";

/**
 * d3's scalePoint has no tick-thinning: without it TanStack Charts falls
 * back to labeling every point, which is unreadable at 30-90 days. `.copy()`
 * (called internally before the scale is used) returns a fresh scalePoint
 * without our patch, so `ticks`/`copy` are re-attached on every copy.
 */
function thinnedPointScale(domain: readonly string[]): ConfiguredScaleLike<string> {
  function attach(scale: ReturnType<typeof scalePoint<string>>): ConfiguredScaleLike<string> {
    const rawCopy = scale.copy.bind(scale);
    const s = Object.assign(scale, {
      ticks: (count: number) => {
        const step = Math.max(1, Math.ceil(domain.length / count));
        return domain.filter((_, i) => i % step === 0);
      },
      copy: () => attach(rawCopy()),
    });
    return s;
  }
  return attach(scalePoint<string>().domain(domain));
}

// Monotone rather than a cubic that overshoots: it never draws a peak or a
// trough the data doesn't have, so the smoothing stays a reading aid.
const smoothCurve = d3Curve(curveMonotoneX);

// One motion renderer per chart type: it holds no per-instance state, so a
// module-level instance avoids reallocating it on every render.
const areaChartMotion = motion<SeriesPoint, string, number>();
const hourBarMotion = motion<{ hour: number; clicks: number }, number, number>();

const defaultTickFormat = (day: string) => day.slice(5);

/**
 * Single-series area chart (clicks over time). One hue (--chart), recessive
 * grid, crosshair + tooltip on hover. No legend: the card title names the
 * series.
 */
export function AreaChart({
  data,
  height = 180,
  tickFormat = defaultTickFormat,
}: {
  data: SeriesPoint[];
  height?: number;
  tickFormat?: (day: string) => string;
}) {
  // Definition identity is the update boundary: recreate it only when the
  // data or formatter actually change, so hover-driven re-renders don't
  // read as a changed chart to the runtime.
  const definition = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => d.clicks));
    return defineChart({
      marks: [
        areaY(data, {
          x: "day",
          y: "clicks",
          key: "day",
          fill: "var(--chart)",
          fillOpacity: 0.14,
          curve: smoothCurve,
        }),
        lineY(data, {
          x: "day",
          y: "clicks",
          key: "day",
          stroke: "var(--chart)",
          strokeWidth: 2,
          curve: smoothCurve,
        }),
        // Vertical guide plus a marker on the focused point, drawn by the
        // renderer inside the plot. The marker's surface-coloured ring is
        // what separates it from the line it sits on.
        crosshair({
          x: true,
          y: false,
          // No animation at all. Any spring here, however stiff, is chasing a
          // target that moves every frame, so it renders behind the cursor:
          // a smooth-looking dot and a dot that keeps up are the same thing
          // only when the position is continuous rather than animated.
          motion: false,
          stroke: "var(--border)",
          strokeWidth: 1,
          marker: {
            radius: 4,
            fill: "var(--chart)",
            stroke: "var(--surface)",
            strokeWidth: 2,
          },
        }),
      ],
      x: {
        scale: thinnedPointScale(data.map((d) => d.day)),
        grid: false,
        // Charts 0.8 moved the tick formatter under `axis.ticks`. It stayed
        // assignable at the axis root, where nothing reads it, so the axis
        // quietly went back to printing whole ISO strings ("2026-07-17"
        // instead of "07-17", and every timestamp in full on the hourly
        // range).
        axis: { ticks: { format: tickFormat } },
      },
      y: {
        scale: scaleLinear().domain([0, max]).nice(),
        grid: true,
      },
      theme: { foreground: "var(--text)", muted: "var(--muted)", grid: "var(--border)" },
      // Nearest-x, unbounded distance: the slice shows anywhere over the
      // chart, not only within a few px of the line itself.
      focus: focusNearestX,
      maxFocusDistance: Infinity,
      // The crosshair mark draws the marker; the built-in ring would double up.
      focusRing: false,
      tooltip: pointerTooltip,
      // Spring settle on range changes (7d/30d/90d) instead of a hard jump.
      motion: { transition: followSpring },
    });
  }, [data, tickFormat]);

  if (!data.length) return null;

  return (
    <RendererChart
      definition={definition}
      renderer={areaChartMotion}
      height={height}
      ariaLabel="Clicks per day"
      renderTooltipBody={({ points }) => {
        const datum = points[0]?.datum;
        if (!datum) return null;
        return (
          <>
            <span className="text-muted">{datum.day}</span>{" "}
            <span className="tnum font-bold">{datum.clicks}</span>
          </>
        );
      }}
    />
  );
}

/**
 * Ranked horizontal bars with direct labels: identity is in the row label,
 * so a single hue does the work.
 */
export function BarList({
  items,
  formatKey = (k) => k,
}: {
  items: { key: string; clicks: number }[];
  formatKey?: (key: string) => string | ReactNode;
}) {
  const max = Math.max(1, ...items.map((i) => i.clicks));
  if (!items.length) return <p className="py-4 text-sm text-muted">No data yet</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate">{formatKey(item.key)}</span>
            <span className="tnum shrink-0 text-muted">{item.clicks}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-chart"
              style={{ width: `${Math.max(2, (item.clicks / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A card of top links by clicks, rendered as a BarList (which already
 * shows its own "No data yet" for an empty list). */
export function TopLinksCard({
  topLinks,
  limit,
}: {
  topLinks: { id: string; slug: string; title: string; clicks: number }[];
  limit?: number;
}) {
  const rows = limit ? topLinks.slice(0, limit) : topLinks;
  return (
    <Card>
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Top links</p>
      <BarList
        items={rows.map((l) => ({
          key: `/${l.slug}${l.title ? ` · ${l.title}` : ""}`,
          clicks: l.clicks,
        }))}
      />
    </Card>
  );
}

export function StatCard({
  label,
  value,
  delta,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  delta?: DeltaValue | null;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg bg-surface p-4 smooth-shadow-ring-xs">
      <p className="truncate text-2xs tracking-wider text-muted uppercase">{label}</p>
      <p className="tnum mt-1 text-2xl font-bold">
        {prefix}
        {formatNumber(value)}
        {suffix}
      </p>
      {delta && delta.pct !== null && <DeltaBadge pct={delta.pct} />}
    </div>
  );
}

function DeltaBadge({ pct }: { pct: number }) {
  const up = pct > 0;
  const flat = pct === 0;
  const color = flat ? "text-muted" : up ? "text-accent-2" : "text-danger";
  return (
    <span className={`tnum mt-1 inline-flex items-center gap-0.5 text-xs ${color}`}>
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}

/**
 * Day-of-week × hour-of-day activity heatmap. Sequential color scale from
 * the --chart hue. Compact enough to live inside a card. Tooltip appears
 * immediately on hover (no native-title delay), matching the other charts.
 */
/**
 * Clicks by hour of day, summed over the whole range. The weekday half of
 * the old day-by-hour grid lives next to this as a BarList: two flat
 * questions, each answered plainly, instead of one grid that needed square
 * tiles and a colour ramp to be read at all.
 */
export function ClicksByHour({ data, height = 260 }: { data: HeatmapRow[]; height?: number }) {
  const hours = useMemo(() => clicksByHour(data), [data]);

  const definition = useMemo(() => {
    const max = Math.max(1, ...hours.map((h) => h.clicks));
    return defineChart({
      marks: [
        barY(hours, {
          x: "hour",
          y: "clicks",
          key: "hour",
          fill: "var(--chart)",
          radius: 2,
          inset: 1,
        }),
      ],
      // All 24 hours are labelled: they fit, and thinning them would make the
      // reader count bars to find an hour. `thin` drops labels itself if a
      // narrow card ever takes that choice away.
      x: {
        scale: scaleBand<number>().domain(HOURS),
        grid: false,
        axis: { tickLabels: { thin: true } },
      },
      y: { scale: scaleLinear().domain([0, max]).nice(), grid: true },
      theme: { foreground: "var(--text)", muted: "var(--muted)", grid: "var(--border)" },
      focusRing: false,
      tooltip: pointerTooltip,
    });
  }, [hours]);

  if (!data.length) return null;

  return (
    <RendererChart
      definition={definition}
      renderer={hourBarMotion}
      height={height}
      ariaLabel="Clicks by hour of day"
      renderTooltipBody={({ points }) => {
        const datum = points[0]?.datum;
        if (!datum) return null;
        return (
          <>
            <span className="text-muted">{datum.hour}:00</span>{" "}
            <span className="tnum font-bold">{datum.clicks}</span>
          </>
        );
      }}
    />
  );
}

/**
 * Compact link card used in the analytics dead/decaying link lists.
 */
export function LinkListCard({
  title,
  links,
}: {
  title: string;
  links: { id: string; slug: string; title: string; suffix?: string; domain?: string | null }[];
}) {
  return (
    <div className="rounded-lg bg-surface p-4 smooth-shadow-ring-xs">
      <p className="mb-2 text-2xs tracking-wider text-muted uppercase">{title}</p>
      {links.length === 0 ? (
        <p className="py-2 text-sm text-muted">No data yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 text-xs">
              <SlugLink
                to={
                  l.domain
                    ? `/links/${l.slug}?domain=${encodeURIComponent(l.domain)}`
                    : `/links/${l.slug}`
                }
                slug={l.slug}
                title={l.title}
              />
              {l.suffix && <span className="tnum shrink-0 text-muted">{l.suffix}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const COUNTRY_NAMES = new Intl.DisplayNames("en", { type: "region" });
const fmtCountry = (key: string) => {
  try {
    return COUNTRY_NAMES.of(key) ?? key;
  } catch {
    return key;
  }
};

export function ClickBreakdown({
  countries,
  referrers,
  devices,
}: {
  countries: TopEntry[];
  referrers: TopEntry[];
  devices: TopEntry[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Countries</p>
        {/* The map holds a 960:500 frame whatever width it gets, while the
            list grows a row per country, so side by side the map's column
            runs out of map long before the list runs out of rows. It only
            splits once the column is wide enough for that gap to be small,
            and the map sits centred in whatever is left. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="self-center lg:col-span-2">
            <CountryMap countries={countries} />
          </div>
          <BarList items={countries.map((c) => ({ ...c, key: fmtCountry(c.key) }))} />
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Referrers</p>
          <BarList items={referrers} />
        </Card>
        <Card>
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Devices</p>
          <BarList items={devices} />
        </Card>
      </div>
    </div>
  );
}
