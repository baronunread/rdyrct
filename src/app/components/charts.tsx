import { Fragment, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { SeriesPoint, DeltaValue, HeatmapRow, TopEntry } from "@/shared/types";
import { Card } from "../ui/misc";

// Chart geometry constants — shared by every AreaChart render.
const WIDTH = 640; // viewBox units; scales to container
const PAD = { top: 12, right: 8, bottom: 22, left: 34 };

/**
 * Single-series area chart (clicks over time). One hue (--chart), recessive
 * grid, crosshair + tooltip on hover. No legend: the card title names the
 * series.
 */
export function AreaChart({
  data,
  height = 180,
  tickFormat = (day) => day.slice(5),
}: {
  data: SeriesPoint[];
  height?: number;
  tickFormat?: (day: string) => string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const { max, points, path, area, ticks } = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => d.clicks));
    const x = (i: number) =>
      PAD.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const points = data.map((d, i) => ({ x: x(i), y: y(d.clicks), ...d }));
    const path = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join("");
    const area = `${path}L${points.at(-1)!.x.toFixed(1)},${PAD.top + innerH}L${points[0].x.toFixed(1)},${PAD.top + innerH}Z`;
    const step = Math.max(1, Math.floor(data.length / 5));
    const ticks = points.filter((_, i) => i % step === 0);
    return { max, points, path, area, ticks };
  }, [data, innerH, innerW]);

  if (!data.length) return null;

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    for (let i = 1; i < points.length; i++)
      if (Math.abs(points[i].x - px) < Math.abs(points[best].x - px)) best = i;
    setHover(best);
  };

  const h = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="block w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Clicks per day"
      >
        {/* recessive grid: three horizontal lines */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={PAD.top + innerH * f}
              y2={PAD.top + innerH * f}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray={f === 1 ? undefined : "3 5"}
            />
            <text
              x={PAD.left - 6}
              y={PAD.top + innerH * f + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--muted)"
              className="tnum"
            >
              {Math.round(max * (1 - f))}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text
            key={t.day}
            x={t.x}
            y={height - 6}
            textAnchor="middle"
            fontSize="9"
            fill="var(--muted)"
          >
            {tickFormat(t.day)}
          </text>
        ))}
        <path d={area} fill="var(--chart)" opacity="0.14" />
        <path d={path} fill="none" stroke="var(--chart)" strokeWidth="2" />
        {h && (
          <g>
            <line
              x1={h.x}
              x2={h.x}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--muted)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {/* 2px surface ring so the marker separates from the line */}
            <circle
              cx={h.x}
              cy={h.y}
              r="4"
              fill="var(--chart)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute -top-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${(h.x / WIDTH) * 100}%`,
            transform: h.x > WIDTH * 0.7 ? "translateX(-105%)" : "translateX(8px)",
          }}
        >
          <span className="text-muted">{h.day}</span>{" "}
          <span className="tnum font-bold">{h.clicks}</span>
        </div>
      )}
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
        <li key={item.key} title={`${item.key}: ${item.clicks}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate">{formatKey(item.key)}</span>
            <span className="tnum text-muted">{item.clicks}</span>
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

/**
 * Day-of-week × hour-of-day activity heatmap. Sequential color scale from
 * the --chart hue. Compact enough to live inside a card.
 */
export function Heatmap({ data }: { data: HeatmapRow[] }) {
  const max = Math.max(1, ...data.map((r) => r.clicks));
  const grid: (HeatmapRow | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
  for (const row of data) grid[row.dayOfWeek][row.hour] = row;

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[auto_repeat(24,1fr)] gap-px text-4xs">
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
                  title={cell ? `${day} ${h}:00 — ${cell.clicks} clicks` : ""}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
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
            <li key={l.id} className="flex items-center justify-between text-xs">
              <Link
                to={
                  l.domain
                    ? `/links/${l.slug}?domain=${encodeURIComponent(l.domain)}`
                    : `/links/${l.slug}`
                }
                className="truncate text-accent hover:underline"
              >
                /{l.slug}
                {l.title ? ` · ${l.title}` : ""}
              </Link>
              {l.suffix && <span className="tnum text-muted">{l.suffix}</span>}
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
    <>
      <Card>
        <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Countries</p>
        <BarList items={countries.map((c) => ({ ...c, key: fmtCountry(c.key) }))} />
      </Card>
      <Card>
        <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Referrers</p>
        <BarList items={referrers} />
      </Card>
      <Card>
        <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Devices</p>
        <BarList items={devices} />
      </Card>
    </>
  );
}
