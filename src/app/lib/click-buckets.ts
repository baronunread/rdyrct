import type { HeatmapRow } from "@/shared/types";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export interface HeatmapGrid {
  cells: number[][];
  dayTotals: number[];
  hourTotals: number[];
  total: number;
  max: number;
}

export function heatmapGrid(data: HeatmapRow[]): HeatmapGrid {
  const cells = WEEKDAYS.map(() => HOURS.map(() => 0));
  const dayTotals = WEEKDAYS.map(() => 0);
  const hourTotals = HOURS.map(() => 0);
  let total = 0;
  let max = 0;
  for (const { dayOfWeek, hour, clicks } of data) {
    const row = cells[dayOfWeek];
    if (!row || hour < 0 || hour > 23) continue;
    row[hour] += clicks;
    dayTotals[dayOfWeek] += clicks;
    hourTotals[hour] += clicks;
    total += clicks;
    max = Math.max(max, row[hour]);
  }
  return { cells, dayTotals, hourTotals, total, max };
}
