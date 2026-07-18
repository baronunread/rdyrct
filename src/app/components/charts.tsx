import { useMemo, useRef, useState } from "react";
import type { SeriesPoint } from "@/shared/types";

/**
 * Single-series area chart (clicks over time). One hue (--chart), recessive
 * grid, crosshair + tooltip on hover. No legend: the card title names the
 * series.
 */
export function AreaChart({
  data,
  height = 180,
}: {
  data: SeriesPoint[];
  height?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 640; // viewBox units; scales to container
  const pad = { top: 12, right: 8, bottom: 22, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const { max, points, path, area, ticks } = useMemo(() => {
    const max = Math.max(1, ...data.map((d) => d.clicks));
    const x = (i: number) =>
      pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = (v: number) => pad.top + innerH - (v / max) * innerH;
    const points = data.map((d, i) => ({ x: x(i), y: y(d.clicks), ...d }));
    const path = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join("");
    const area = `${path}L${points.at(-1)!.x.toFixed(1)},${pad.top + innerH}L${points[0].x.toFixed(1)},${pad.top + innerH}Z`;
    const step = Math.max(1, Math.floor(data.length / 5));
    const ticks = points.filter((_, i) => i % step === 0);
    return { max, points, path, area, ticks };
  }, [data, innerH, innerW]);

  if (!data.length) return null;

  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
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
        viewBox={`0 0 ${width} ${height}`}
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
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + innerH * f}
              y2={pad.top + innerH * f}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray={f === 1 ? undefined : "3 5"}
            />
            <text
              x={pad.left - 6}
              y={pad.top + innerH * f + 3}
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
            {t.day.slice(5)}
          </text>
        ))}
        <path d={area} fill="var(--chart)" opacity="0.14" />
        <path d={path} fill="none" stroke="var(--chart)" strokeWidth="2" />
        {h && (
          <g>
            <line
              x1={h.x}
              x2={h.x}
              y1={pad.top}
              y2={pad.top + innerH}
              stroke="var(--muted)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {/* 2px surface ring so the marker separates from the line */}
            <circle cx={h.x} cy={h.y} r="4" fill="var(--chart)" stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute -top-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${(h.x / width) * 100}%`,
            transform: h.x > width * 0.7 ? "translateX(-105%)" : "translateX(8px)",
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
 * Ranked horizontal bars with direct labels — identity is in the row label,
 * so a single hue does the work.
 */
export function BarList({
  items,
  formatKey = (k) => k,
}: {
  items: { key: string; clicks: number }[];
  formatKey?: (key: string) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.clicks));
  if (!items.length)
    return <p className="py-4 text-sm text-muted">No data yet</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.key} title={`${formatKey(item.key)}: ${item.clicks}`}>
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

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] tracking-wider text-muted uppercase">{label}</p>
      <p className="tnum mt-1 text-2xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}
