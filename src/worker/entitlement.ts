import { sql } from "drizzle-orm";
import { lookup } from "../shared/lookup";
import type { OrgPlan } from "@/shared/types";

/**
 * `plan` is the only column anything reads for access. A comp outranks a
 * subscription, so `subscription.revoked` cannot strip access an admin granted (#81).
 */

/**
 * `past_due` keeps access on purpose: Polar retries a failed payment for days and
 * sends `subscription.revoked` when it gives up. `canceled` only appears once
 * the subscription is over; until then it stays `active`.
 */
export const SUBSCRIPTION_ACCESS = {
  active: true,
  trialing: true,
  past_due: true,
  canceled: false,
  unpaid: false,
  incomplete: false,
  incomplete_expired: false,
} satisfies Record<string, boolean>;

/** Fails closed: a status with no rule grants nothing. */
export function subscriptionGrantsAccess(status: string | null | undefined): boolean {
  return status ? (lookup(SUBSCRIPTION_ACCESS, status) ?? false) : false;
}

export function resolveEffectivePlan(row: {
  compPlan?: OrgPlan | null;
  subscriptionPlan?: OrgPlan | null;
  subscriptionStatus?: string | null;
}): OrgPlan {
  if (row.compPlan) return row.compPlan;
  if (row.subscriptionPlan && subscriptionGrantsAccess(row.subscriptionStatus))
    return row.subscriptionPlan;
  return "free";
}

/** Bound parameters, built from the table above so the two cannot drift. */
const ACCESS_STATUSES = sql.join(
  Object.entries(SUBSCRIPTION_ACCESS).flatMap(([status, allowed]) =>
    allowed ? [sql`${status}`] : [],
  ),
  sql`, `,
);

/**
 * SQLite applies a SET clause against the row as it was before the statement,
 * so the column being written in the same statement is passed in: `overrides`.
 */
export function effectivePlanSql(overrides: {
  compPlan?: string | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
}) {
  const comp = "compPlan" in overrides ? sql`${overrides.compPlan ?? null}` : sql`comp_plan`;
  const plan =
    "subscriptionPlan" in overrides
      ? sql`${overrides.subscriptionPlan ?? null}`
      : sql`subscription_plan`;
  const status =
    "subscriptionStatus" in overrides
      ? sql`${overrides.subscriptionStatus ?? null}`
      : sql`subscription_status`;
  return sql`coalesce(${comp}, case when ${status} in (${ACCESS_STATUSES}) then ${plan} end, 'free')`;
}
