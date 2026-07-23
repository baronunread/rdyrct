import { format, formatDistanceToNow } from "date-fns";

export function shortDate(ts: number | string | Date): string {
  return format(new Date(ts), "MMM d, yyyy");
}

export function relativeDate(ts: number | string | Date): string {
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}
