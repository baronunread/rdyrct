const SHORT_DATE = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function shortDate(ts: number | string | Date): string {
  return SHORT_DATE.format(new Date(ts));
}

export function relativeDate(ts: number | string | Date): string {
  const diff = new Date(ts).getTime() - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return RELATIVE.format(Math.round(diff / ms), unit);
  }
  return RELATIVE.format(Math.round(diff / 1000), "second");
}

export const dayTick = (day: string) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export const hourTick = (day: string) => day.slice(11, 16);
