import { useDeferredValue, useMemo, useRef, useState } from "react";
import { IconArrowDown, IconArrowUp, IconSearch } from "@tabler/icons-react";
import { HrefLink } from "../lib/router-search";
import { Flag } from "./source-tile";
import type { ReactNode, UIEvent } from "react";
import { areaY, defineChart, lineY } from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { curveMonotoneX } from "d3-shape";
import { crosshair } from "@tanstack/charts/crosshair";
import { focusNearestX } from "@tanstack/charts/focus";
import { motion } from "@tanstack/charts/motion";
import { chartMotion } from "../lib/chart-motion";
import { RendererChart } from "@tanstack/react-charts/tooltip";
import { seriesTooltip } from "./chart-tooltip";
import { ClicksTip } from "./clicks-tip";
import type { SeriesPoint, DeltaValue, TopEntry } from "@/shared/types";
import { CountryMap } from "./country-map";
import { PanelTabs } from "../ui/tabs";
import { Dialog, usePhone } from "../ui/dialog";
import { Input } from "../ui/field";
import { cn } from "../ui/cn";
import { countryName } from "../lib/places";
import { linkPagePath } from "../lib/link-display";
import { formatNumber } from "../lib/numbers";

// Monotone: never draws a peak or trough the data does not have.
const smoothCurve = d3Curve(curveMonotoneX);

const areaChartMotion = motion<SeriesPoint, string, number>(chartMotion);

const defaultTickFormat = (day: string) => day.slice(5);

function evenTicks<T>(values: T[]): T[] {
  if (values.length <= 8) return values;
  const last = values.length - 1;
  return [0, 1, 2, 3, 4].flatMap((i) => {
    const v = values[Math.round((i * last) / 4)];
    return v === undefined ? [] : [v];
  });
}

function yTop(max: number): number {
  const nice = scaleLinear().domain([0, max]).nice(4).domain()[1];
  const top = Math.max(2, Math.ceil(nice));
  return top % 2 === 0 ? top : top + 1;
}

export function AreaChart({
  data,
  height = 180,
  tickFormat = defaultTickFormat,
}: {
  data: SeriesPoint[];
  height?: number;
  tickFormat?: (day: string) => string;
}) {
  // Definition identity is the update boundary: recreate only when data or formatter change.
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
        crosshair({
          x: true,
          y: false,
          strokeDasharray: "3 3",
          // No animation: a spring chases a target that moves every frame, so the dot lags the cursor.
          motion: false,
          stroke: "var(--placeholder)",
          strokeWidth: 1,
        }),
      ],
      scales: {
        x: {
          scale: scalePoint<string>().domain(data.map((d) => d.day)),
          grid: false,
          // Charts 0.8: the tick formatter lives under `axis.ticks`. At the axis root it is ignored
          // and the axis prints whole ISO strings.
          axis: {
            line: false,
            ticks: { format: tickFormat, size: 0, values: evenTicks(data.map((d) => d.day)) },
          },
        },
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
      focus: focusNearestX,
      maxFocusDistance: Infinity,
      focusRing: false,
      tooltip: seriesTooltip,
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

interface BarListProps {
  items: { key: string; clicks: number }[];
  formatKey?: (key: string) => string | ReactNode;
  lead?: (key: string) => ReactNode;
  empty?: string;
  head?: [string, string];
  searchBy?: (key: string) => string;
}

const ROW_PX = 32;

type ScrollEdge = "above" | "below" | "both" | "none";

function useScrollEdge() {
  const [edge, setEdge] = useState<ScrollEdge>("below");
  const onScroll = (e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const above = el.scrollTop > 1;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdge(above && below ? "both" : above ? "above" : below ? "below" : "none");
  };
  return { edge, onScroll };
}

const EDGE_FADE = {
  below: "sm:[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]",
  above: "sm:[mask-image:linear-gradient(to_bottom,transparent,black_16px)]",
  both: "sm:[mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-24px),transparent)]",
  none: "",
} satisfies Record<ScrollEdge, string>;

function scrollBox(edge: ScrollEdge): string {
  return cn("overscroll-contain sm:overflow-y-auto sm:pb-3", EDGE_FADE[edge]);
}

export function BarList({
  items,
  formatKey = (k) => k,
  lead,
  empty = "Nothing recorded in this period yet.",
  head,
  limit,
}: Omit<BarListProps, "searchBy"> & {
  limit?: number;
}) {
  const { edge, onScroll } = useScrollEdge();
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
          scrolls && scrollBox(edge),
        )}
        style={scrolls ? { maxHeight: `${limit * ROW_PX + 12}px` } : undefined}
        onScroll={onScroll}
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
                style={{ width: item.clicks ? `${Math.max(2, (item.clicks / max) * 100)}%` : 0 }}
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

function searchText(key: string, list: BarListProps): string {
  return list.searchBy?.(key) ?? key;
}

function BarListDialog({
  title,
  open,
  onOpenChange,
  ...list
}: BarListProps & { title: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  // Open on the search, but not on a phone, where focus would put the keyboard over the sheet.
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
      <div className="flex flex-col">
        <span className="sticky -top-1 z-10 -mt-1 block bg-surface pt-1 pb-3">
          <IconSearch
            size={15}
            aria-hidden
            className="pointer-events-none absolute top-[calc(50%-4px)] left-3 z-10 -translate-y-1/2 text-muted"
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

export interface ChartFigure {
  label: string;
  value: ReactNode;
  delta?: DeltaValue | null;
}

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

const placeName = (code: string) => (code === "unknown" ? "Unknown" : countryName(code));

// Nine rows of ROW_PX run as tall as the map and its footnote.
const MAP_HEIGHT = { desk: 270, phone: 220 };
const MAP_ROWS = { desk: 9, phone: 7 };

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
