/** Redirects never stop: past the cap a link keeps redirecting and its clicks are not recorded. */
import { PLAN_LIMITS, type OrgPlan } from "./types";
import { SUPPORT_EMAIL } from "./support";

export const CLICK_WARN_SHARE = 0.8;

export function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

export function nextMonthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export type ClickUsageLevel = "under" | "near" | "reached";

export function clickUsageLevel(clicks: number, limit: number): ClickUsageLevel {
  if (clicks >= limit) return "reached";
  if (clicks >= limit * CLICK_WARN_SHARE) return "near";
  return "under";
}

const EXACT = new Intl.NumberFormat("en-US");

/** Exact, since the app's compact 4.1k is too coarse near the cap. */
export function exactCount(n: number): string {
  return EXACT.format(n);
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

export function monthName(ms: number): string {
  return MONTH.format(ms);
}

export function resetDay(ms: number): string {
  return DAY.format(nextMonthStart(ms));
}

export function moreClicksLine(plan: OrgPlan): string | null {
  const hobby = exactCount(PLAN_LIMITS.hobby.trackedClicks);
  const pro = exactCount(PLAN_LIMITS.pro.trackedClicks);
  if (plan === "free") return `Hobby counts ${hobby} clicks a month, and Pro ${pro}.`;
  if (plan === "hobby") return `Pro counts ${pro} clicks a month.`;
  return null;
}

function writeForMoreLine(isOwner: boolean): string {
  return isOwner
    ? `For more, write to ${SUPPORT_EMAIL}.`
    : `The owner can write to ${SUPPORT_EMAIL} for more.`;
}

export function reachedSentence(limit: number, now: number): string {
  return `Your links still work. Clicks past ${exactCount(limit)} this month are not counted until ${resetDay(now)}.`;
}

export function nearSentence(limit: number, now: number): string {
  return `Past ${exactCount(limit)}, your links keep working, but their clicks are not counted until ${resetDay(now)}.`;
}

/** Says "this organization", not a name: the default "jane's links" reads badly. */
export function clickCapNotice(
  org: { plan: OrgPlan; role?: string } | null | undefined,
  usage: { clicks: number; limit: number } | undefined,
  now: number,
): { text: string; offerUpgrade: boolean } | null {
  if (!org || !usage) return null;
  const isOwner = org.role === "owner";
  const level = clickUsageLevel(usage.clicks, usage.limit);
  if (level === "under") return null;
  const more = moreClicksLine(org.plan) !== null;
  const limit = exactCount(usage.limit);
  const next = !more
    ? ` ${writeForMoreLine(isOwner)}`
    : isOwner
      ? " Upgrade to count them."
      : " The owner can upgrade to count them.";
  const text =
    level === "reached"
      ? // The cap, not the count: after a downgrade the count can be far past
        // it, and "recorded its 5,000" would then be false.
        `This organization has reached the ${limit} clicks its plan counts in ${monthName(now)}. ${reachedSentence(usage.limit, now)}${next}`
      : `This organization has recorded ${exactCount(usage.clicks)} of the ${limit} clicks its plan counts this month. ${nearSentence(usage.limit, now)}`;
  return { text, offerUpgrade: more && isOwner };
}
