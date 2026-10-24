/**
 * Tracked clicks per org per calendar month (#387): the arithmetic and the
 * words, shared by the Worker (the cap, the emails) and the app (the billing
 * meter, the banner), so the two can never describe the cap differently.
 *
 * A month is the UTC calendar month. Redirects never stop: past the cap a
 * link keeps redirecting and its clicks are simply not recorded.
 */
import { PLAN_LIMITS, type OrgPlan } from "./types";

/** The share of the cap at which the owner hears about it the first time. */
export const CLICK_WARN_SHARE = 0.8;

/** The UTC month a millisecond timestamp falls in, as `YYYY-MM`: the key the
 * counter is stored under. */
export function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** When the count starts again: the first instant of the next UTC month. */
export function nextMonthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export type ClickUsageLevel = "under" | "near" | "reached";

/** Where a month's count stands against its cap. */
export function clickUsageLevel(clicks: number, limit: number): ClickUsageLevel {
  if (clicks >= limit) return "reached";
  if (clicks >= limit * CLICK_WARN_SHARE) return "near";
  return "under";
}

const EXACT = new Intl.NumberFormat("en-US");

/** An exact count with a pinned separator: 4,132. A usage figure near its cap
 * has to be exact, which the app's compact 4.1k is not. */
export function exactCount(n: number): string {
  return EXACT.format(n);
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** "October", for the month a timestamp falls in (UTC). */
export function monthName(ms: number): string {
  return MONTH.format(ms);
}

/** "November 1", the day the count starts again after `ms`. */
export function resetDay(ms: number): string {
  return DAY.format(nextMonthStart(ms));
}

/**
 * What upgrading would count, or null when no plan counts more. Hobby is
 * named alongside Pro for a free org, since both count more; a Hobby org only
 * has Pro above it.
 */
export function moreClicksLine(plan: OrgPlan): string | null {
  const hobby = exactCount(PLAN_LIMITS.hobby.trackedClicks);
  const pro = exactCount(PLAN_LIMITS.pro.trackedClicks);
  if (plan === "free") return `Hobby counts ${hobby} clicks a month, and Pro ${pro}.`;
  if (plan === "hobby") return `Pro counts ${pro} clicks a month.`;
  return null;
}

/** The sentence the banner and the 100% email share: what keeps working and
 * what stopped. */
export function reachedSentence(limit: number, now: number): string {
  return `Your links still work. Clicks past ${exactCount(limit)} this month are not counted until ${resetDay(now)}.`;
}

/** The sentence the banner and the 80% email share. */
export function nearSentence(limit: number, now: number): string {
  return `Past ${exactCount(limit)}, your links keep working, but their clicks are not counted until ${resetDay(now)}.`;
}

/**
 * The app's banner, or null below 80% or before both have loaded. It sits inside the org it is about,
 * so it says "this organization" rather than a name, which reads badly when
 * the name is the default "jane's links". `isOwner` decides who is told to
 * upgrade: only the owner's plan counts, so anybody else is told who can.
 */
export function clickCapNotice(
  org: { plan: OrgPlan; role?: string } | null | undefined,
  usage: { clicks: number; limit: number } | undefined,
  now: number,
): { text: string; offerUpgrade: boolean } | null {
  // Nothing loaded yet is nothing to say.
  if (!org || !usage) return null;
  const isOwner = org.role === "owner";
  const level = clickUsageLevel(usage.clicks, usage.limit);
  if (level === "under") return null;
  const more = moreClicksLine(org.plan) !== null;
  const limit = exactCount(usage.limit);
  const upgrade = !more
    ? ""
    : isOwner
      ? " Upgrade to count them."
      : " The owner can upgrade to count them.";
  const text =
    level === "reached"
      ? // The cap, not the count: after a downgrade the count can be far past
        // it, and "recorded its 5,000" would then be false.
        `This organization has reached the ${limit} clicks its plan counts in ${monthName(now)}. ${reachedSentence(usage.limit, now)}${upgrade}`
      : `This organization has recorded ${exactCount(usage.clicks)} of the ${limit} clicks its plan counts this month. ${nearSentence(usage.limit, now)}`;
  return { text, offerUpgrade: more && isOwner };
}
