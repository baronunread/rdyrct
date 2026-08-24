/**
 * How long a locked resource has left, in words (#159).
 *
 * Its own module rather than a second export from the component file that
 * uses it, so the domains page can read the same sentence without importing
 * a React module for a string.
 */

/** Days left, rounded up, so the last day reads "1 day" rather than "0". */
function daysLeft(until: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((until - now) / 86_400_000));
}

/** "30 days left" / "1 day left" / "the grace period has ended". */
export function graceLabel(until: number, now = Date.now()): string {
  const days = daysLeft(until, now);
  if (days === 0) return "the grace period has ended";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

/** Whether the deadline is still ahead. The copy around a countdown reads as
 * a promise ("keeps working until X"), so it must not render once X is past. */
export function graceRunning(until: number | null | undefined, now = Date.now()): boolean {
  return until != null && until > now;
}
