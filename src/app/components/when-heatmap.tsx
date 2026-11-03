import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { HOURS, WEEKDAYS, heatmapGrid } from "../lib/click-buckets";
import { formatNumber, formatNumberShort } from "../lib/numbers";
import { Tooltip, TooltipGroup } from "../ui/tooltip";
import { shade } from "./country-map";
import { lookup } from "@/shared/lookup";
import type { HeatmapRow } from "@/shared/types";

/** Hours per label and per total, so 24 columns stay readable at 390px: the
 * labels and the totals row both work in blocks of this many hours. */
const BLOCK = 3;
const BLOCKS = HOURS.filter((h) => h % BLOCK === 0);

const hh = (hour: number) => `${String(hour % 24).padStart(2, "0")}:00`;
const clicksWord = (n: number) => `${formatNumber(n)} ${n === 1 ? "click" : "clicks"}`;

/** [days, hours] each arrow key moves. */
const ARROWS = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
} as const;

interface CellAt {
  day: number;
  hour: number;
}

/** One hour of one weekday: shaded by its share of the busiest cell, with
 * the tooltip and the ring on hover or keyboard focus. */
function HeatCell({
  day,
  position,
  clicks,
  max,
  tabStop,
  onFocus,
}: {
  day: string;
  position: CellAt;
  clicks: number;
  max: number;
  /** The one cell the grid's Tab key lands on. */
  tabStop: boolean;
  onFocus: (at: CellAt) => void;
}) {
  const label = `${day}, ${hh(position.hour)} to ${hh(position.hour + 1)}`;
  return (
    <Tooltip
      grouped
      content={
        <>
          {label} <span aria-hidden>·</span>{" "}
          <span className="tnum font-semibold">{clicksWord(clicks)}</span>
        </>
      }
    >
      <div
        role="gridcell"
        tabIndex={tabStop ? 0 : -1}
        data-cell={`${position.day}-${position.hour}`}
        aria-label={`${label}, ${clicksWord(clicks)}`}
        onFocus={() => onFocus(position)}
        style={{ backgroundColor: clicks ? shade(clicks / max) : "var(--surface-2)" }}
        className="h-4 rounded-[2px] outline-2 -outline-offset-1 outline-transparent hover:z-10 hover:outline-text focus-visible:z-10 focus-visible:outline-text sm:h-5 sm:rounded-[3px]"
      />
    </Tooltip>
  );
}

/**
 * When clicks happen: weekday by hour of the day, in UTC (the rollups bucket
 * by UTC hour). Cells shade from --surface-2 (none) to the accent on a square
 * root, as the country map does. Totals are plain muted figures: one at the
 * end of each day, and one under every three hours (a 9px column cannot hold
 * a number). The grid is one tab stop; arrow keys move between cells, and a
 * focused cell shows the same tooltip as a hovered one.
 */
export function WhenHeatmap({ data }: { data: HeatmapRow[] }) {
  const grid = useMemo(() => heatmapGrid(data), [data]);
  const [at, setAt] = useState({ day: 0, hour: 0 });
  const root = useRef<HTMLDivElement>(null);

  const move = (e: KeyboardEvent) => {
    const delta = lookup(ARROWS, e.key);
    if (!delta) return;
    e.preventDefault();
    const day = Math.min(6, Math.max(0, at.day + delta[0]));
    const hour = Math.min(23, Math.max(0, at.hour + delta[1]));
    setAt({ day, hour });
    root.current?.querySelector<HTMLElement>(`[data-cell="${day}-${hour}"]`)?.focus();
  };

  const blockTotal = (start: number) =>
    grid.hourTotals.slice(start, start + BLOCK).reduce((a, b) => a + b, 0);

  return (
    <TooltipGroup>
      <div
        ref={root}
        role="grid"
        aria-label="Clicks by day of the week and hour of the day, in UTC"
        onKeyDown={move}
        className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))_auto] gap-0.5"
      >
        <div role="row" className="contents">
          {/* An empty cell over the day names; sr-only would take it out of
              the grid and shift every column. */}
          <span role="columnheader" aria-label="Day" />
          {BLOCKS.map((h) => (
            <span
              key={h}
              role="columnheader"
              aria-label={`${hh(h)} to ${hh(h + BLOCK)}`}
              className="tnum col-span-3 h-4 text-xs leading-4 whitespace-nowrap text-muted"
            >
              {h}
            </span>
          ))}
          <span role="columnheader" className="pl-2 text-right text-xs leading-4 text-muted">
            All
          </span>
        </div>
        {WEEKDAYS.map((day, d) => (
          <div key={day} role="row" className="contents">
            <span role="rowheader" className="pr-2 text-xs leading-4 text-muted sm:leading-5">
              {day}
            </span>
            {HOURS.map((h) => (
              <HeatCell
                key={h}
                day={day}
                position={{ day: d, hour: h }}
                clicks={grid.cells[d]?.[h] ?? 0}
                max={grid.max}
                tabStop={at.day === d && at.hour === h}
                onFocus={setAt}
              />
            ))}
            <span
              role="gridcell"
              aria-label={`${day} total, ${clicksWord(grid.dayTotals[d] ?? 0)}`}
              className="tnum pl-2 text-right text-xs leading-4 text-muted sm:leading-5"
            >
              {formatNumber(grid.dayTotals[d] ?? 0)}
            </span>
          </div>
        ))}
        <div role="row" className="contents">
          <span role="rowheader" className="mt-1 pr-2 text-xs leading-4 text-muted">
            All
          </span>
          {BLOCKS.map((h) => (
            <span
              key={h}
              role="gridcell"
              aria-label={`${hh(h)} to ${hh(h + BLOCK)} total, ${clicksWord(blockTotal(h))}`}
              className="tnum col-span-3 mt-1 text-xs leading-4 text-muted"
            >
              {formatNumberShort(blockTotal(h))}
            </span>
          ))}
          <span
            role="gridcell"
            aria-label={`Total, ${clicksWord(grid.total)}`}
            className="tnum mt-1 pl-2 text-right text-xs leading-4 text-muted"
          >
            {formatNumber(grid.total)}
          </span>
        </div>
      </div>
    </TooltipGroup>
  );
}
