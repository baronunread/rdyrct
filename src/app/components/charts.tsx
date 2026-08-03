import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { scaleLinear, scalePoint } from "d3-scale";
import {
  areaY,
  defineChart,
  lineY,
  type ChartPoint,
  type ConfiguredScaleLike,
} from "@tanstack/charts";
import { focusNearestX } from "@tanstack/charts/focus";
import { motion } from "@tanstack/charts/motion";
import { Chart } from "@tanstack/react-charts/core";
import type { SeriesPoint, DeltaValue, HeatmapRow, TopEntry } from "@/shared/types";
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
    const s = scale as unknown as ConfiguredScaleLike<string>;
    s.ticks = (count: number) => {
      const step = Math.max(1, Math.ceil(domain.length / count));
      return domain.filter((_, i) => i % step === 0);
    };
    s.copy = () => attach(rawCopy());
    return s;
  }
  return attach(scalePoint<string>().domain(domain));
}

type AreaChartPoint = ChartPoint<SeriesPoint, string, number>;

// One motion renderer per chart type: it holds no per-instance state, so a
// module-level instance avoids reallocating it on every render.
const areaChartMotion = motion<SeriesPoint, string, number>();

/** Vertical hover line + marker dot over the hovered point, if any. */
function ChartCrosshair({
  point,
  scene,
}: {
  point: AreaChartPoint;
  scene: { width: number; height: number; chartTop: number; chartHeight: number };
}) {
  const leftPct = (point.x / scene.width) * 100;
  return (
    <>
      <div
        className="pointer-events-none absolute w-px bg-border"
        style={{
          left: `${leftPct}%`,
          top: `${(scene.chartTop / scene.height) * 100}%`,
          height: `${(scene.chartHeight / scene.height) * 100}%`,
        }}
      />
      {/* 2px surface ring so the marker separates from the line */}
      <div
        className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart"
        style={{
          left: `${leftPct}%`,
          top: `${(point.y / scene.height) * 100}%`,
          border: "2px solid var(--surface)",
        }}
      />
    </>
  );
}

/** Tracks the raw cursor position, not the snapped data point, so it reads
 * as gliding next to the mouse instead of hopping between points. */
function ChartTooltip({
  point,
  mouse,
}: {
  point: AreaChartPoint;
  mouse: { leftPct: number; topPct: number };
}) {
  const flip = mouse.leftPct > 70;
  return (
    <div
      className="pointer-events-none absolute rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg transition-[left,top] duration-75 ease-out"
      style={{
        left: `${mouse.leftPct}%`,
        top: `${mouse.topPct}%`,
        transform: `translate(${flip ? "-105%" : "16px"}, -50%)`,
      }}
    >
      <span className="text-muted">{point.datum.day}</span>{" "}
      <span className="tnum font-bold">{point.datum.clicks}</span>
    </div>
  );
}

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
  const [focus, setFocus] = useState<AreaChartPoint | null>(null);
  const [mouse, setMouse] = useState({ leftPct: 0, topPct: 0 });
  const [scene, setScene] = useState<{
    width: number;
    height: number;
    chartTop: number;
    chartHeight: number;
  } | null>(null);
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
        }),
        lineY(data, {
          x: "day",
          y: "clicks",
          key: "day",
          stroke: "var(--chart)",
          strokeWidth: 2,
        }),
      ],
      x: {
        scale: thinnedPointScale(data.map((d) => d.day)),
        grid: false,
        format: tickFormat,
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
      // We paint our own crosshair dot below; the built-in ring would double up.
      focusRing: false,
      // Spring settle on range changes (7d/30d/90d) instead of a hard jump.
      motion: { transition: { type: "spring", stiffness: 170, damping: 22, mass: 1 } },
    });
  }, [data, tickFormat]);

  if (!data.length) return null;

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({
      leftPct: (100 * (e.clientX - rect.left)) / rect.width,
      topPct: (100 * (e.clientY - rect.top)) / rect.height,
    });
  };

  return (
    <div className="relative" onMouseMove={onMouseMove}>
      <Chart
        definition={definition}
        renderer={areaChartMotion}
        height={height}
        ariaLabel="Clicks per day"
        onFocusChange={setFocus}
        onRender={({ scene: s }) =>
          setScene((prev) =>
            prev &&
            prev.width === s.width &&
            prev.height === s.height &&
            prev.chartTop === s.chart.y &&
            prev.chartHeight === s.chart.height
              ? prev
              : {
                  width: s.width,
                  height: s.height,
                  chartTop: s.chart.y,
                  chartHeight: s.chart.height,
                },
          )
        }
      />
      {focus && scene && <ChartCrosshair point={focus} scene={scene} />}
      {focus && <ChartTooltip point={focus} mouse={mouse} />}
    </div>
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
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="truncate text-2xs tracking-wider text-muted uppercase">{label}</p>
      <p className="tnum mt-1 text-2xl font-bold">
        {prefix}
        {value.toLocaleString()}
        {suffix}
      </p>
      {delta && delta.pct !== null && <DeltaBadge pct={delta.pct} />}
    </div>
  );
}

function DeltaBadge({ pct }: { pct: number }) {
  const up = pct > 0;
  const flat = pct === 0;
  const color = flat ? "text-muted" : up ? "text-green-400" : "text-red-400";
  return (
    <span className={`tnum mt-1 inline-flex items-center gap-0.5 text-xs ${color}`}>
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}

const HEATMAP_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HEATMAP_HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Fixed to the viewport (escapes the heatmap's overflow-x-auto clipping,
 * unlike an absolutely-positioned tooltip nested inside it) and follows the
 * raw cursor position, flipping near the window edges so it stays visible. */
function HeatmapTooltip({
  day,
  hour,
  clicks,
  x,
  y,
}: {
  day: string;
  hour: number;
  clicks: number;
  x: number;
  y: number;
}) {
  const flipX = x > window.innerWidth - 80;
  const flipY = y < 60;
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
      style={{
        left: x,
        top: y,
        transform: `translate(${flipX ? "-100%" : "-50%"}, calc(${flipY ? "12px" : "-100% - 12px"}))`,
      }}
    >
      <span className="text-muted">
        {day} {hour}:00
      </span>{" "}
      <span className="tnum font-bold">{clicks}</span>
    </div>
  );
}

/**
 * Day-of-week × hour-of-day activity heatmap. Sequential color scale from
 * the --chart hue. Compact enough to live inside a card. Tooltip appears
 * immediately on hover (no native-title delay), matching the other charts.
 */
export function Heatmap({ data }: { data: HeatmapRow[] }) {
  const max = Math.max(1, ...data.map((r) => r.clicks));
  const grid: (HeatmapRow | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
  for (const row of data) grid[row.dayOfWeek][row.hour] = row;

  const [hover, setHover] = useState<{
    day: string;
    hour: number;
    clicks: number;
    x: number;
    y: number;
  } | null>(null);

  const onMove =
    (day: string, hour: number, clicks: number) => (e: React.MouseEvent<HTMLDivElement>) => {
      setHover({ day, hour, clicks, x: e.clientX, y: e.clientY });
    };

  return (
    <div className="relative overflow-x-auto">
      <div
        className="grid grid-cols-[auto_repeat(24,1fr)] gap-px text-4xs"
        onMouseLeave={() => setHover(null)}
      >
        <div />
        {HEATMAP_HOURS.map((h) => (
          <div key={h} className="text-center text-muted">
            {h}
          </div>
        ))}
        {HEATMAP_DAYS.map((day, di) => (
          <Fragment key={day}>
            <div className="pr-1.5 text-right text-muted">{day}</div>
            {HEATMAP_HOURS.map((h) => {
              const cell = grid[di][h];
              const opacity = cell ? 0.1 + (cell.clicks / max) * 0.9 : 0;
              return (
                <div
                  key={`${di}-${h}`}
                  className="aspect-square rounded-sm"
                  style={{
                    backgroundColor: `color-mix(in srgb, var(--chart) ${opacity * 100}%, transparent)`,
                  }}
                  onMouseMove={cell ? onMove(day, h, cell.clicks) : undefined}
                  onMouseEnter={cell ? undefined : () => setHover(null)}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      {hover && (
        <HeatmapTooltip
          day={hover.day}
          hour={hover.hour}
          clicks={hover.clicks}
          x={hover.x}
          y={hover.y}
        />
      )}
    </div>
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
    <div className="rounded-lg border border-border bg-surface p-4">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
          <CountryMap countries={countries} />
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
