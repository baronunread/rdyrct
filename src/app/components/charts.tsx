import { useMemo, useState } from "react";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { HrefLink } from "../lib/router-search";
import { Flag } from "./source-tile";
import type { ReactNode } from "react";
import { areaY, barY, defineChart, lineY } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { curveMonotoneX } from "d3-shape";
import { crosshair } from "@tanstack/charts/crosshair";
import { focusNearestX } from "@tanstack/charts/focus";
import { motion } from "@tanstack/charts/motion";
import { chartMotion } from "../lib/chart-motion";
import { RendererChart } from "@tanstack/react-charts/tooltip";
import { pointerTooltip } from "./chart-tooltip";
import { clicksByHour, HOURS } from "../lib/click-buckets";
import type { SeriesPoint, DeltaValue, HeatmapRow, TopEntry } from "@/shared/types";
import { CountryMap } from "./country-map";
import { PanelTabs } from "../ui/tabs";
import { countryName } from "../lib/places";
import { linkPagePath } from "../lib/link-display";
import { formatNumber } from "../lib/numbers";

// Monotone rather than a cubic that overshoots: it never draws a peak or a
// trough the data doesn't have, so the smoothing stays a reading aid.
const smoothCurve = d3Curve(curveMonotoneX);

// One motion renderer per chart type: it holds no per-instance state, so a
// module-level instance avoids reallocating it on every render.
const areaChartMotion = motion<SeriesPoint, string, number>(chartMotion);
const hourBarMotion = motion<{ hour: number; clicks: number }, number, number>(chartMotion);

const defaultTickFormat = (day: string) => day.slice(5);

/** Every value up to eight; past that, five evenly spaced, ends included. */
function evenTicks<T>(values: T[]): T[] {
  if (values.length <= 8) return values;
  const last = values.length - 1;
  return [0, 1, 2, 3, 4].flatMap((i) => {
    const v = values[Math.round((i * last) / 4)];
    return v === undefined ? [] : [v];
  });
}

/** The top of the y scale: the max rounded up to a nice even number, so the
 * half-way hairline lands on a whole click count too. */
function yTop(max: number): number {
  const nice = scaleLinear().domain([0, max]).nice(4).domain()[1];
  const top = Math.max(2, Math.ceil(nice));
  return top % 2 === 0 ? top : top + 1;
}

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
    const top = yTop(Math.max(1, ...data.map((d) => d.clicks)));
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
      // Charts 0.18 (Alpha) moved the Cartesian scales under `scales`.
      scales: {
        x: {
          scale: scalePoint<string>().domain(data.map((d) => d.day)),
          grid: false,
          // Charts 0.8 moved the tick formatter under `axis.ticks`. It stayed
          // assignable at the axis root, where nothing reads it, so the axis
          // quietly went back to printing whole ISO strings ("2026-07-17"
          // instead of "07-17", and every timestamp in full on the hourly
          // range).
          // Stubs off. A week labels every day; anything longer labels five
          // evenly spaced days, first and last included, rather than letting
          // the renderer thin a crowd of labels into an uneven row.
          axis: {
            line: false,
            ticks: { format: tickFormat, size: 0, values: evenTicks(data.map((d) => d.day)) },
          },
        },
        // Three hairlines (zero, half, top) labelled on the right, where the
        // line ends and the eye already is. No axis line: the zero hairline
        // is the baseline.
        y: {
          scale: scaleLinear().domain([0, top]),
          side: "right",
          grid: true,
          axis: {
            line: false,
            ticks: { values: [0, top / 2, top], size: 0, format: (v: number) => formatNumber(v) },
          },
        },
      },
      theme: { foreground: "var(--text)", muted: "var(--muted)", grid: "var(--border)" },
      // Nearest-x, unbounded distance: the slice shows anywhere over the
      // chart, not only within a few px of the line itself.
      focus: focusNearestX,
      maxFocusDistance: Infinity,
      // The crosshair mark draws the marker; the built-in ring would double up.
      focusRing: false,
      tooltip: pointerTooltip,
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
            <span className="text-muted">{tickFormat(datum.day)}</span>{" "}
            <span className="tnum font-bold">{datum.clicks}</span>
          </>
        );
      }}
    />
  );
}

/**
 * Ranked bars with the label inside: each row is a tinted bar sized to its
 * value, the label sits on it, and the count and its share line up in their
 * own columns (rdyrct-design, "The app's surfaces"). One scale per list, so a
 * bar's length still encodes its value; identity is in the label, so one hue
 * does the work.
 */
export function BarList({
  items,
  formatKey = (k) => k,
  lead,
  empty = "Nothing recorded in this period yet.",
  head,
  limit,
}: {
  items: { key: string; clicks: number }[];
  formatKey?: (key: string) => string | ReactNode;
  /** A flag or a site's letter tile ahead of each label. */
  lead?: (key: string) => ReactNode;
  /** What will appear here, said in the caller's own words. "No data" tells
   *  somebody nothing; naming the thing that fills the list explains the
   *  feature and points at the next step in the same sentence. */
  empty?: string;
  /** Column headings, e.g. ["Country", "Clicks"]. */
  head?: [string, string];
  /** Rows shown before "Show all N". Unset shows every row. */
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(1, ...items.map((i) => i.clicks));
  const total = items.reduce((sum, i) => sum + i.clicks, 0) || 1;
  if (!items.length) return <p className="py-4 text-sm text-pretty text-muted">{empty}</p>;
  const cut = limit !== undefined && items.length > limit;
  const shown = cut && !expanded ? items.slice(0, limit) : items;
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-center gap-x-3 gap-y-0.5 text-sm">
        {head && (
          <>
            <span className="pb-1 text-xs text-muted">{head[0]}</span>
            <span className="pb-1 text-right text-xs text-muted">{head[1]}</span>
            <span />
          </>
        )}
        {shown.map((item) => (
          <div key={item.key} className="group contents">
            <div className="relative flex h-[30px] min-w-0 items-center gap-2 px-2">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 rounded-md bg-chart/10 transition-colors duration-150 ease-out [@media(hover:hover)]:group-hover:bg-chart/20"
                style={{ width: `${Math.max(2, (item.clicks / max) * 100)}%` }}
              />
              {lead && <span className="relative flex shrink-0">{lead(item.key)}</span>}
              <span className="relative min-w-0 truncate">{formatKey(item.key)}</span>
            </div>
            <span className="tnum text-right">{formatNumber(item.clicks)}</span>
            <span className="tnum text-right text-xs text-muted">
              {Math.round((item.clicks / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
      {cut && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mx-auto mt-2 -mb-1 flex h-7 cursor-pointer items-center rounded-md px-2 text-xs text-muted transition-colors duration-150 ease-out [@media(hover:hover)]:hover:text-text"
        >
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/** A link in a bar list: its slug, which is what people search for and
 * type, then its title in the muted voice (rdyrct-design, mono only on the
 * identifier). */

export function LinkBarLabel({
  slug,
  title,
  domain,
}: {
  slug: string;
  title?: string;
  domain?: string | null;
}) {
  return (
    <HrefLink
      href={linkPagePath({ slug, domain })}
      title={title ? `/${slug} · ${title}` : `/${slug}`}
      className="[@media(hover:hover)]:hover:underline"
    >
      <span className="font-mono text-[13px]">/{slug}</span>
      {title && <span className="text-muted"> {title}</span>}
    </HrefLink>
  );
}

/** One figure in a StatsChart strip. */
export interface ChartFigure {
  label: string;
  value: ReactNode;
  delta?: DeltaValue | null;
}

/**
 * The figures and the chart in one card (rdyrct-design, "Stats and the chart
 * share a card"): a strip of figures above the chart, the first shaded
 * because it is the one the chart plots, each with its change beside it.
 */
export function StatsChart({ figures, children }: { figures: ChartFigure[]; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface smooth-shadow-ring-xs">
      <dl className="flex flex-wrap gap-1 p-1.5">
        {figures.map((f, i) => (
          <div
            key={f.label}
            className={`flex min-w-[40%] flex-1 flex-col gap-0.5 rounded-lg px-2.5 py-2 sm:min-w-0 ${i === 0 ? "bg-bg" : ""}`}
          >
            <dt className="truncate text-xs text-muted">{f.label}</dt>
            <dd className="tnum flex min-w-0 items-baseline gap-2 text-xl leading-tight font-semibold tracking-tight">
              <span className="truncate">{f.value}</span>
              {f.delta && f.delta.pct !== null && <DeltaBadge pct={f.delta.pct} />}
            </dd>
          </div>
        ))}
      </dl>
      <div className="px-4 pt-1 pb-3">{children}</div>
    </div>
  );
}

/** The change beside a figure: an arrow and the size of the move. The arrow
 * carries the direction, so the colour never has to on its own. */
function DeltaBadge({ pct }: { pct: number }) {
  const up = pct > 0;
  const flat = pct === 0;
  const color = flat ? "text-muted" : up ? "text-accent-2" : "text-danger";
  const Arrow = up ? IconArrowUp : IconArrowDown;
  return (
    <span className={`tnum inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      {!flat && <Arrow aria-hidden size={12} stroke={2.25} />}
      <span className="sr-only">{flat ? "No change" : up ? "Up" : "Down"}</span>
      {Math.abs(pct)}%
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
    const top = yTop(Math.max(1, ...hours.map((h) => h.clicks)));
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
      scales: {
        x: {
          scale: scaleBand<number>().domain(HOURS),
          grid: false,
          axis: { line: false, ticks: { size: 0 }, tickLabels: { thin: true } },
        },
        // Same y axis as the clicks chart: three hairlines, labelled on the
        // right, no axis line.
        y: {
          scale: scaleLinear().domain([0, top]),
          side: "right",
          grid: true,
          axis: {
            line: false,
            ticks: { values: [0, top / 2, top], size: 0, format: (v: number) => formatNumber(v) },
          },
        },
      },
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

/** "Italy" from "IT"; a click the edge could not place says so. */
const placeName = (code: string) => (code === "unknown" ? "Unknown" : countryName(code));

/** Countries as bars, with the map one tab away. */
export function PlacesPanel({
  countries,
  period,
  limit,
}: {
  countries: TopEntry[];
  period?: string;
  /** Rows before "Show all N". */
  limit?: number;
}) {
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
              items={countries}
              formatKey={placeName}
              lead={(code) => <Flag code={code} />}
              limit={limit}
              empty="The country each click came from appears here. No IP address is stored."
            />
          ),
        },
        { value: "map", label: "Map", panel: <CountryMap countries={countries} /> },
      ]}
    />
  );
}
