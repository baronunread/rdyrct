/**
 * Which plan covers what somebody needs, for the pricing page's plan finder.
 *
 * Pure, and read straight off PLAN_LIMITS, so the answer can never disagree
 * with the limits the Worker enforces.
 */
import { PLAN_LIMITS, type OrgPlan } from "@/shared/types";

export const NEED_KEYS = ["links", "members", "domains", "analyticsDays"] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
export type Needs = Record<NeedKey, number>;

const ORDER: readonly OrgPlan[] = ["free", "hobby", "pro"];

/** One limit of the next plan down that the needs go past. */
export type Overage = { key: NeedKey; need: number; limit: number };

export type PlanFit =
  | { plan: OrgPlan; over: Overage[]; below: OrgPlan | null }
  | { plan: null; over: Overage[]; below: "pro" };

const fits = (plan: OrgPlan, needs: Needs) =>
  NEED_KEYS.every((key) => needs[key] <= PLAN_LIMITS[plan][key]);

const overages = (plan: OrgPlan, needs: Needs): Overage[] =>
  NEED_KEYS.filter((key) => needs[key] > PLAN_LIMITS[plan][key]).map((key) => ({
    key,
    need: needs[key],
    limit: PLAN_LIMITS[plan][key],
  }));

/** The cheapest plan that covers `needs`, and what ruled out the one below
 * it. `plan: null` means even Pro is not enough. */
export function planFor(needs: Needs): PlanFit {
  const index = ORDER.findIndex((plan) => fits(plan, needs));
  if (index === -1) return { plan: null, over: overages("pro", needs), below: "pro" };
  const below = index > 0 ? ORDER[index - 1] : null;
  return { plan: ORDER[index], over: below ? overages(below, needs) : [], below };
}
