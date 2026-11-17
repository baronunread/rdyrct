function daysLeft(until: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((until - now) / 86_400_000));
}

export function graceLabel(until: number, now = Date.now()): string {
  const days = daysLeft(until, now);
  if (days === 0) return "the grace period has ended";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

// The copy reads as a promise ("keeps working until X"), so it must not render once X is past.
export function graceRunning(until: number | null | undefined, now = Date.now()): boolean {
  return until != null && until > now;
}
