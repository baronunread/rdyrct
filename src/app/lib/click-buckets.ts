import type { HeatmapRow } from "@/shared/types";

/** Monday-first, matching the order the stats query returns rows in. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Clicks per weekday, summed across every hour, ready for a BarList. */
export function clicksByWeekday(data: HeatmapRow[]): { key: string; clicks: number }[] {
  const totals = WEEKDAYS.map((day) => ({ key: day, clicks: 0 }));
  for (const row of data) totals[row.dayOfWeek].clicks += row.clicks;
  return totals;
}

/** Clicks per hour of the day, summed across every weekday. */
export function clicksByHour(data: HeatmapRow[]): { hour: number; clicks: number }[] {
  const totals = HOURS.map((hour) => ({ hour, clicks: 0 }));
  for (const row of data) totals[row.hour].clicks += row.clicks;
  return totals;
}
