import * as v from "valibot";
import {
  PLAN_LIMITS,
  type AccountTier,
  type JsonValue,
  type LimitOverrides,
  type OrgPlan,
  type PlanLimits,
} from "./types";

/** Only keys that differ from the plan are stored. One schema for reads and the admin route's body,
 * so nothing can be written that a read would refuse. */
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

export function parseLimitOverrides(candidate: JsonValue): LimitOverrides | null {
  if (Array.isArray(candidate)) return null;
  const parsed = v.safeParse(limitOverridesSchema, candidate);
  return parsed.success ? parsed.output : null;
}

/** An override can only raise a limit. Overrides count only on a paid plan: on Free they stay saved and
 * apply again on the next paid plan; `unlimited` (self-hosted) has nothing to raise. */
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

/** Free keeps its overrides but they do not count, so it stays Free. */
export function tierOf(plan: OrgPlan, overrides: LimitOverrides = {}): AccountTier {
  const paid = plan === "hobby" || plan === "pro";
  return paid && Object.keys(overrides).length > 0 ? "enterprise" : plan;
}
