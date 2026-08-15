import { sql } from "drizzle-orm";
import { lookup } from "../shared/lookup";
import type { OrgPlan } from "@/shared/types";

/**
 * What a user may do, and what a user pays, are two facts (#81).
 *
 * - `subscription_plan` / `subscription_status`: what Polar says. Only the
 *   webhook writes them.
 * - `comp_plan`: what an admin granted by hand. Only the comp routes write it.
 * - `plan`: derived from both, and the only column anything reads to decide
 *   access.
 *
 * A comp outranks a subscription, so a `subscription.revoked` cannot strip
 * access an admin granted, and a comp cannot rewrite what Polar reported.
 */

/** Polar's subscription statuses, and whether each one keeps paid access.
 *
 * `past_due` keeps access on purpose. Polar retries a failed payment for days
 * and sends `subscription.revoked` when it gives up, so cutting access at the
 * first failure punishes an expired card rather than a non-payer. The state is
 * recorded and shown in admin instead.
 *
 * `canceled` does not keep access. A subscription the customer cancelled for
 * the end of the period stays `active` with `cancel_at_period_end` until it
 * ends; the status only reads `canceled` once it is actually over.
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

/** The same decision the SQL below makes, in TypeScript, for tests and for
 * code holding a row it has already read. */
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

/** The statuses that keep access, as a SQL list, built from the table above so
 * the two cannot drift.
 *
 * Each one is a bound parameter rather than a quoted string spliced into the
 * statement. These particular values are literals written above and could not
 * carry an injection, but a raw splice is a habit worth not having in a file
 * about who gets paid access. */
const ACCESS_STATUSES = sql.join(
  Object.entries(SUBSCRIPTION_ACCESS).flatMap(([status, allowed]) =>
    allowed ? [sql`${status}`] : [],
  ),
  sql`, `,
);

/**
 * `plan` recomputed from the two source columns, for the SET clause of any
 * statement that changes either of them.
 *
 * It reads the columns rather than taking values, so one expression serves
 * both a webhook write (which changes `subscription_*` and leaves `comp_*`
 * alone) and a comp write (the reverse). SQLite applies a SET clause against
 * the row as it was before the statement, so the column being written in the
 * same statement has to be passed in: `overrides` does that.
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
