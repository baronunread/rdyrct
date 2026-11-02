import { useDeferredValue, useMemo, useRef, useState } from "react";
import { IconArrowDown, IconArrowUp, IconSearch } from "@tabler/icons-react";
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
import { ClicksTip } from "./clicks-tip";
import { clicksByHour, HOURS } from "../lib/click-buckets";
import type { SeriesPoint, DeltaValue, HeatmapRow, TopEntry } from "@/shared/types";
import { CountryMap } from "./country-map";
import { PanelTabs } from "../ui/tabs";
import { Dialog, usePhone } from "../ui/dialog";
import { Input } from "../ui/field";
import { cn } from "../ui/cn";
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
        // A vertical guide on the focused day, no marker: the line already
        // says where the point is.
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
      // No ring on the focused point either.
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
        return <ClicksTip label={tickFormat(datum.day)} clicks={datum.clicks} />;
      }}
    />
  );
}

/** A bar list's rows, its column heads and how it labels and leads each row:
 * everything a list needs, wherever it is drawn (a card or the Show all
 * dialog). */
interface BarListProps {
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
  /** What Show all's search matches a row by, when that is not its key (a
   * country's name rather than its code, a link's slug and title rather
   * than its id). */
  searchBy?: (key: string) => string;
}

/** One row's height plus the gap under it, in px: what `limit` rows take. */
const ROW_PX = 32;

/**
 * Ranked bars with the label inside: each row is a tinted bar sized to its
 * value, the label sits on it, and the count lines up in its own column
 * (rdyrct-design, "The app's surfaces"). No percentage: the bar already says
 * the share. One scale per list, so a bar's length still encodes its value;
 * identity is in the label, so one hue does the work.
 *
 * With `limit`, the card stays `limit` rows tall and the rest scroll under
 * the column heads; on a phone, where a box that scrolls inside a page that
 * scrolls is a trap, it shows the first `limit` and no more. Show all
 * (listTab, below) opens every row with a search.
 */
export function BarList({
  items,
  formatKey = (k) => k,
  lead,
  empty = "Nothing recorded in this period yet.",
  head,
  limit,
}: Omit<BarListProps, "searchBy"> & {
  /** Rows before the list scrolls. Unset shows every row. */
  limit?: number;
}) {
  const max = Math.max(1, ...items.map((i) => i.clicks));
  if (!items.length) return <p className="py-4 text-sm text-pretty text-muted">{empty}</p>;
  const scrolls = limit !== undefined && items.length > limit;
  return (
    <div className="flex flex-col">
      {head && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 pb-1 text-xs text-muted">
          <span>{head[0]}</span>
          <span className="text-right">{head[1]}</span>
        </div>
      )}
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-sm",
          scrolls &&
            "overscroll-contain sm:overflow-y-auto sm:pb-3 sm:[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]",
        )}
        style={scrolls ? { maxHeight: `${limit * ROW_PX + 12}px` } : undefined}
      >
        {items.map((item, i) => (
          <div
            key={item.key}
            className={cn("group contents", scrolls && i >= limit && "max-sm:hidden")}
          >
            <div className="relative flex h-[30px] min-w-0 items-center gap-2 px-2">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 rounded-md bg-chart/10 transition-colors duration-150 ease-out [@media(hover:hover)]:group-hover:bg-chart/20"
                style={{ width: `${Math.max(2, (item.clicks / max) * 100)}%` }}
              />
              {lead && <span className="relative flex shrink-0">{lead(item.key)}</span>}
              <span className="relative min-w-0 truncate">{formatKey(item.key)}</span>
            </div>
            <span className="tnum pr-1 text-right">{formatNumber(item.clicks)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The text a row is searched by: searchBy's, else its key. */
function searchText(key: string, list: BarListProps): string {
  return list.searchBy?.(key) ?? key;
}

/** Every row of a list, in a dialog with a search (a sheet on a phone). */
function BarListDialog({
  title,
  open,
  onOpenChange,
  ...list
}: BarListProps & { title: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  // Open on the search, typing being why somebody opens every row; not on a
  // phone, where focus would put the keyboard over the sheet.
  const search = useRef<HTMLInputElement>(null);
  const phone = usePhone();
  const typed = useDeferredValue(query.trim().toLowerCase());
  const shown = typed
    ? list.items.filter((i) => searchText(i.key, list).toLowerCase().includes(typed))
    : list.items;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      initialFocus={phone ? undefined : search}
    >
      <div className="flex flex-col gap-3">
        <span className="relative block">
          <IconSearch
            size={15}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-muted"
          />
          <Input
            ref={search}
            type="search"
            value={query}
            placeholder={`Search ${title.toLowerCase()}`}
            aria-label={`Search ${title.toLowerCase()}`}
            className="pl-9"
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <BarList {...list} items={shown} empty={`Nothing matches “${query.trim()}”.`} />
      </div>
    </Dialog>
  );
}

/** "Show all 9", in the card's top-right corner: opens BarListDialog. */
function ShowAll({ title, ...list }: BarListProps & { title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded text-xs text-muted transition-colors duration-150 ease-out [@media(hover:hover)]:hover:text-text"
      >
        Show all {list.items.length}
      </button>
      <BarListDialog title={title} open={open} onOpenChange={setOpen} {...list} />
    </>
  );
}

/**
 * A PanelTabs tab holding a BarList: the list scrolls past `limit` rows, and
 * once it does, Show all sits in the card's corner. The dialog is titled with
 * the tab's own label.
 */
export function listTab({
  value,
  label,
  limit,
  ...list
}: BarListProps & { value: string; label: string; limit?: number }) {
  const more = limit !== undefined && list.items.length > limit;
  return {
    value,
    label,
    panel: <BarList {...list} limit={limit} />,
    end: more ? <ShowAll title={label} {...list} /> : undefined,
  };
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
 * share a card"): a strip of figures above the chart, clicks first,
 * right above the line that plots them, each with its change beside it. No
 * figure is marked: only clicks has a series, so a marker would look like a
 * tab that never switches.
 */
export function StatsChart({ figures, children }: { figures: ChartFigure[]; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface smooth-shadow-ring-xs">
      <dl className="flex flex-wrap gap-1 p-1.5">
        {figures.map((f) => (
          <div
            key={f.label}
            className="flex min-w-[40%] flex-1 flex-col gap-0.5 px-2.5 py-2 sm:min-w-0"
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
        return <ClicksTip label={`${datum.hour}:00`} clicks={datum.clicks} />;
      }}
    />
  );
}

/** "Italy" from "IT"; a click the edge could not place says so. */
const placeName = (code: string) => (code === "unknown" ? "Unknown" : countryName(code));

/** The map's height beside the list, and the rows that fill it: nine rows of
 * ROW_PX run as tall as the map and its footnote. A phone stacks the two, so
 * the map gets a shorter box and the list its usual seven. */
const MAP_HEIGHT = { desk: 270, phone: 220 };
const MAP_ROWS = { desk: 9, phone: 7 };

/**
 * Countries, a full-width card: the map on the left, the ranked list on its
 * right, under one Countries tab with Show all in the corner. The list needs
 * no column heads; the tab already says what it lists. On a phone the map
 * sits over the list.
 */
export function PlacesPanel({
  countries,
  period,
  className,
}: {
  countries: TopEntry[];
  period?: string;
  className?: string;
}) {
  const phone = usePhone();
  const list = listTab({
    value: "countries",
    label: "Countries",
    items: countries,
    formatKey: placeName,
    searchBy: placeName,
    lead: (code) => <Flag code={code} />,
    limit: phone ? MAP_ROWS.phone : MAP_ROWS.desk,
    empty: "The country each click came from appears here. No IP address is stored.",
  });
  return (
    <PanelTabs
      className={className}
      end={period}
      tabs={[
        {
          ...list,
          panel: countries.length ? (
            <div className="grid grid-cols-1 gap-x-7 gap-y-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:items-start">
              <CountryMap
                countries={countries.filter((c) => c.key !== "unknown")}
                height={phone ? MAP_HEIGHT.phone : MAP_HEIGHT.desk}
              />
              {list.panel}
            </div>
          ) : (
            list.panel
          ),
        },
      ]}
    />
  );
}
