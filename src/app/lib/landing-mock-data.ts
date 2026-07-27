import type { HeatmapRow, SeriesPoint } from "@/shared/types";

// Deterministic pseudo-random generator (LCG): the mock data is identical on
// every visit, so the demo never looks stale or jumps between renders.
function lcg(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/** Daily clicks with a weekly rhythm and a gentle upward trend. */
export function dailyClicks(days: number, base: number, growth: number, seed: number): number[] {
  const rand = lcg(seed);
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const weekly = 1 + 0.3 * Math.sin(((i % 7) / 7) * Math.PI * 2);
    const trend = 1 + (growth * i) / days;
    out.push(Math.max(1, Math.round(base * weekly * trend * (0.7 + rand() * 0.6))));
  }
  return out;
}

/** Date-labeled points ending today, mirroring the real stats payload. */
export function toDailyPoints(values: number[]): SeriesPoint[] {
  const now = Date.now();
  return values.map((clicks, i) => ({
    day: new Date(now - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    clicks,
  }));
}

/** The last 24 hours, labeled like the real hourly buckets ("… 14:00"). */
export function hourlyPoints(): SeriesPoint[] {
  const rand = lcg(7);
  const hourMs = 3_600_000;
  const start = Math.floor((Date.now() - 23 * hourMs) / hourMs) * hourMs;
  return Array.from({ length: 24 }, (_, i) => {
    const d = new Date(start + i * hourMs);
    const hour = Number(d.toISOString().slice(11, 13));
    const business = hour >= 8 && hour <= 19;
    const base = business ? 42 : 8;
    return {
      day: `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 13)}:00`,
      clicks: Math.round(base * (0.6 + rand() * 0.8)),
    };
  });
}

/** Weekday-business-hours heatmap, like a small B2B audience would produce. */
export function heatmapData(): HeatmapRow[] {
  const rand = lcg(99);
  const rows: HeatmapRow[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const business = d < 5 && h >= 8 && h <= 18;
      const evening = h >= 19 && h <= 22;
      const base = business ? 26 : evening ? 14 : 3;
      rows.push({ dayOfWeek: d, hour: h, clicks: Math.round(base * (0.5 + rand())) });
    }
  }
  return rows;
}
