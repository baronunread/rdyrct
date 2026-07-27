import { shortDate } from "./dates";

/** "today" / "3d ago" / a date, for the users table's last-seen column. */
export function lastSeenLabel(ts: number | null): string {
  if (!ts) return "never";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return shortDate(ts);
}
