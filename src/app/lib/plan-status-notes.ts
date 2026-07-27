import type { OrgPlan } from "@/shared/types";

/** Whether cancellation is scheduled and we know when it takes effect. */
export function showsCancelNotice(
  cancelAtPeriodEnd: boolean,
  periodEnd: number | null,
): periodEnd is number {
  return cancelAtPeriodEnd && periodEnd != null;
}

/** Whether the "still confirming" note applies: the upgrade poll gave up
 * before the plan actually switched over. */
export function showsConfirmingNotice(confirmTimedOut: boolean, plan: OrgPlan): boolean {
  return confirmTimedOut && plan === "free";
}
