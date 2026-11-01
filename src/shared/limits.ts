import * as v from "valibot";
import {
  PLAN_LIMITS,
  type AccountTier,
  type JsonValue,
  type LimitOverrides,
  type OrgPlan,
  type PlanLimits,
} from "./types";

/**
 * Per-account custom limits: the Enterprise arrangement, set by a platform
 * admin and stored as JSON in `user.limit_overrides`. Only the keys that
 * differ from the plan are there.
 *
 * The one schema for them. The Worker parses the column with it wherever it
 * reads one, and the admin route parses the request body with it, so a value
 * can never be written that a read would refuse.
 */
const whole = (max: number) => v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(max));

export const limitOverridesSchema = v.object({
  orgs: v.optional(whole(1_000)),
  links: v.optional(whole(10_000_000)),
  members: v.optional(whole(100_000)),
  domains: v.optional(whole(10_000)),
  qrCustom: v.optional(v.boolean()),
  analyticsDays: v.optional(whole(3_650)),
  trackedClicks: v.optional(whole(1_000_000_000)),
});

/** The overrides a candidate object spells, or null when it is not valid
 * overrides. Unknown keys are dropped. */
export function parseLimitOverrides(candidate: JsonValue): LimitOverrides | null {
  // An array is an object to the schema, and no overrides to anyone else.
  if (Array.isArray(candidate)) return null;
  const parsed = v.safeParse(limitOverridesSchema, candidate);
  return parsed.success ? parsed.output : null;
}

/**
 * What an account may actually use: per key, the higher of its plan's value
 * and its override, and for the one flag the plan's or the override's. An
 * override can only raise a limit, never lower it.
 *
 * Overrides are part of a paid arrangement, so they count only while the plan
 * is paid. On Free they are ignored (the rows stay saved, and apply again on
 * the next paid plan), and `unlimited`, the self-hosted plan with no billing,
 * has nothing to raise. The rule is here so no caller can forget it.
 */
export function effectiveLimits(plan: OrgPlan, overrides: LimitOverrides = {}): PlanLimits {
  const base = PLAN_LIMITS[plan];
  if (plan === "free" || plan === "unlimited") return { ...base };
  return {
    orgs: Math.max(base.orgs, overrides.orgs ?? 0),
    links: Math.max(base.links, overrides.links ?? 0),
    members: Math.max(base.members, overrides.members ?? 0),
    domains: Math.max(base.domains, overrides.domains ?? 0),
    qrCustom: base.qrCustom || (overrides.qrCustom ?? false),
    analyticsDays: Math.max(base.analyticsDays, overrides.analyticsDays ?? 0),
    trackedClicks: Math.max(base.trackedClicks, overrides.trackedClicks ?? 0),
  };
}

/**
 * What an account is called: Enterprise when it is on a paid plan (a comp
 * counts, it sets the plan) and has custom limits, otherwise its plan. Free
 * keeps its overrides but they do not count, so it stays Free.
 */
export function tierOf(plan: OrgPlan, overrides: LimitOverrides = {}): AccountTier {
  const paid = plan === "hobby" || plan === "pro";
  return paid && Object.keys(overrides).length > 0 ? "enterprise" : plan;
}
