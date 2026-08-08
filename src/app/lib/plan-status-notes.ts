import type { OrgPlan } from "@/shared/types";

/** Whether cancellation is scheduled and we know when it takes effect.
 *
 * A comp outranks the subscription (`resolveEffectivePlan`), so a comped user
 * whose subscription ends this period keeps the plan. Telling them it ends
 * would be false. */
export function showsCancelNotice(
  cancelAtPeriodEnd: boolean,
  periodEnd: number | null,
  comped: boolean,
): periodEnd is number {
  return cancelAtPeriodEnd && periodEnd != null && !comped;
}

/** Whether the "still confirming" note applies: the upgrade poll gave up
 * before the plan actually switched over. */
export function showsConfirmingNotice(confirmTimedOut: boolean, plan: OrgPlan): boolean {
  return confirmTimedOut && plan === "free";
}
