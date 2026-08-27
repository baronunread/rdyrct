import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireUser } from "../guards";
import { jsonBodyLimit } from "../body-limit";
import type { AppConfig, CurrentUser } from "@/shared/types";
import { orgPlanOf } from "@/shared/types";
import { parseOver } from "../reconcile";

// Signup/login/logout/verification live under /api/auth/* (BetterAuth).
// This router only exposes the app-level session view, mounted at /api.
export const userRoutes = new Hono<AppEnv>();
userRoutes.use("*", jsonBodyLimit());

async function currentUserFor(
  db: AppEnv["Variables"]["db"],
  user: NonNullable<AppEnv["Variables"]["user"]>,
): Promise<CurrentUser> {
  // Each org's effective plan is its OWNER's plan, so join through the org's
  // owner membership to that user's subscription (self-joins on members/user).
  const ownerMember = alias(schema.orgMembers, "owner_member");
  const ownerUser = alias(schema.user, "owner_user");
  // Both queries answer to the same user and neither feeds the other, so
  // they go out together rather than costing this route two round trips.
  const [rows, billingRows] = await Promise.all([
    db
      .select({
        id: schema.orgs.id,
        name: schema.orgs.name,
        role: schema.orgMembers.role,
        ownerPlan: ownerUser.plan,
        qrLogo: schema.orgs.qrLogo,
        qrStyle: schema.orgs.qrStyle,
        qrColor: schema.orgs.qrColor,
        qrCorner: schema.orgs.qrCorner,
        qrBg: schema.orgs.qrBg,
        qrEyeColor: schema.orgs.qrEyeColor,
        qrLogoSize: schema.orgs.qrLogoSize,
        defaultDomainId: schema.orgs.defaultDomainId,
        lockedAt: schema.orgs.lockedAt,
        overJson: schema.orgEntitlements.overJson,
        graceEndsAt: schema.orgEntitlements.graceEndsAt,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.orgs, eq(schema.orgMembers.orgId, schema.orgs.id))
      // Left join: an org nothing has reconciled yet has no row, and is fine.
      .leftJoin(schema.orgEntitlements, eq(schema.orgEntitlements.orgId, schema.orgs.id))
      .leftJoin(
        ownerMember,
        and(eq(ownerMember.orgId, schema.orgs.id), eq(ownerMember.role, "owner")),
      )
      .leftJoin(ownerUser, eq(ownerMember.userId, ownerUser.id))
      .where(eq(schema.orgMembers.userId, user.id)),
    // Not on the session: neither column is one of BetterAuth's additional
    // fields, and adding them there would carry a provider id through every
    // request to serve two booleans on one page.
    db
      .select({ customerId: schema.user.polarCustomerId, compPlan: schema.user.compPlan })
      .from(schema.user)
      .where(eq(schema.user.id, user.id)),
  ]);

  const orgs = rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    plan: orgPlanOf(r.ownerPlan),
    qrLogo: r.qrLogo,
    qrStyle: r.qrStyle,
    qrColor: r.qrColor,
    qrCorner: r.qrCorner,
    qrBg: r.qrBg,
    qrEyeColor: r.qrEyeColor,
    qrLogoSize: r.qrLogoSize,
    defaultDomainId: r.defaultDomainId,
    locked: r.lockedAt != null,
    over: parseOver(r.overJson ?? "{}"),
    graceEndsAt: r.graceEndsAt,
  }));
  return {
    user: {
      ...user,
      hasBillingAccount: Boolean(billingRows[0]?.customerId),
      comped: Boolean(billingRows[0]?.compPlan),
    },
    orgs,
  };
}

userRoutes.get("/user", requireUser, async (c) => {
  const log = c.get("log");
  log.set({ userId: c.var.user!.id });
  return c.json(await currentUserFor(c.var.db, c.var.user!));
});

// Public, non-secret deployment config (the SPA shows appHost in DNS setup
// instructions for custom domains).
userRoutes.get("/config", (c) => {
  const log = c.get("log");
  log.set({ route: "config" });
  return c.json({ appHost: c.env.APP_HOST } satisfies AppConfig);
});
