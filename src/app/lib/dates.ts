import { format, formatDistanceToNow } from "date-fns";

export function shortDate(ts: number | string | Date): string {
  return format(new Date(ts), "MMM d, yyyy");
}

export function shortDateWithYear(ts: number | string | Date): string {
  return format(new Date(ts), "MMM d, yyyy");
}

/** "Feb 14" for recent dates (current year), "Feb 14, 2023" otherwise. */
export function smartDate(ts: number | string | Date): string {
  const d = new Date(ts);
  return d.getFullYear() === new Date().getFullYear()
    ? format(d, "MMM d")
    : format(d, "MMM d, yyyy");
}

export function relativeDate(ts: number | string | Date): string {
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}
