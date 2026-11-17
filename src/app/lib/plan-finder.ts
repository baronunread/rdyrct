// Read straight off PLAN_LIMITS, so the answer can never disagree with the Worker.
import { PLAN_LIMITS, type StoredPlan } from "@/shared/types";

export const NEED_KEYS = ["links", "members", "domains", "analyticsDays", "trackedClicks"] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
export type Needs = Record<NeedKey, number>;

const ORDER: readonly StoredPlan[] = ["free", "hobby", "pro"];

export type Overage = { key: NeedKey; need: number; limit: number };

export type PlanFit =
  | { plan: StoredPlan; over: Overage[]; below: StoredPlan | null }
  | { plan: null; over: Overage[]; below: "pro" };

const fits = (plan: StoredPlan, needs: Needs) =>
  NEED_KEYS.every((key) => needs[key] <= PLAN_LIMITS[plan][key]);

const overages = (plan: StoredPlan, needs: Needs): Overage[] =>
  NEED_KEYS.filter((key) => needs[key] > PLAN_LIMITS[plan][key]).map((key) => ({
    key,
    need: needs[key],
    limit: PLAN_LIMITS[plan][key],
  }));

export function planFor(needs: Needs): PlanFit {
  const index = ORDER.findIndex((plan) => fits(plan, needs));
  if (index === -1) return { plan: null, over: overages("pro", needs), below: "pro" };
  const below = index > 0 ? ORDER[index - 1] : null;
  return { plan: ORDER[index], over: below ? overages(below, needs) : [], below };
}
