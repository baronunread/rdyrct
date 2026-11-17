import type { OrgPlan } from "@/shared/types";

// A comp outranks the subscription (`resolveEffectivePlan`): a comped user whose
// subscription ends this period keeps the plan, so telling them it ends would be false.
export function showsCancelNotice(
  cancelAtPeriodEnd: boolean,
  periodEnd: number | null,
  comped: boolean,
): periodEnd is number {
  return cancelAtPeriodEnd && periodEnd != null && !comped;
}

export function showsConfirmingNotice(confirmTimedOut: boolean, plan: OrgPlan): boolean {
  return confirmTimedOut && plan === "free";
}
