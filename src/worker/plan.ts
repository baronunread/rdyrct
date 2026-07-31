import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB } from "./env";
import { PLAN_LIMITS, type OrgPlan, type PlanLimits } from "@/shared/types";

/**
 * An org's plan = its owner's plan. Billing is per-user (a person holds one
 * Free/Hobby/Pro subscription), so an org's effective limits come from whoever owns
 * it: resolve the owner membership and read that user's plan.
 */
export async function orgPlan(
  db: DB,
  orgId: string,
): Promise<{ plan: OrgPlan; limits: PlanLimits }> {
  const rows = await db
    .select({ plan: schema.user.plan })
    .from(schema.orgMembers)
    .innerJoin(schema.user, eq(schema.orgMembers.userId, schema.user.id))
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, "owner")));
  const plan = rows[0]?.plan ?? "free";
  return { plan, limits: PLAN_LIMITS[plan] };
}

/**
 * How many addresses in this org count toward its `links` plan limit: every
 * link's primary address plus every alias a user chose to keep forever. A
 * rename's automatic 48h temp_alias never counts (see #38) — it's excluded
 * by `kind`, not by any caller-side special case, so every gate (new link,
 * same-destination merge, "keep forever") can share this one count.
 */
export async function countActiveAddresses(db: DB, orgId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.linkAddresses)
    .where(
      and(
        eq(schema.linkAddresses.orgId, orgId),
        isNull(schema.linkAddresses.retiredAt),
        inArray(schema.linkAddresses.kind, ["primary", "permanent_alias"]),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** A user's own subscription: gates multi-org creation and the billing tab. */
export async function userPlan(
  db: DB,
  userId: string,
): Promise<{ plan: OrgPlan; limits: PlanLimits }> {
  const rows = await db
    .select({ plan: schema.user.plan })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const plan = rows[0]?.plan ?? "free";
  return { plan, limits: PLAN_LIMITS[plan] };
}
