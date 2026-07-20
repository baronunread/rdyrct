import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireUser } from "../auth";
import type { AppConfig, CurrentUser, OrgPlan } from "@/shared/types";

// Signup/login/logout/verification live under /api/auth/* (BetterAuth).
// This router only exposes the app-level session view, mounted at /api.
export const userRoutes = new Hono<AppEnv>();

async function currentUserFor(
  db: AppEnv["Variables"]["db"],
  user: NonNullable<AppEnv["Variables"]["user"]>,
): Promise<CurrentUser> {
  // Each org's effective plan is its OWNER's plan, so join through the org's
  // owner membership to that user's subscription (self-joins on members/user).
  const ownerMember = alias(schema.orgMembers, "owner_member");
  const ownerUser = alias(schema.user, "owner_user");
  const rows = await db
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
    })
    .from(schema.orgMembers)
    .innerJoin(schema.orgs, eq(schema.orgMembers.orgId, schema.orgs.id))
    .leftJoin(
      ownerMember,
      and(
        eq(ownerMember.orgId, schema.orgs.id),
        eq(ownerMember.role, "owner"),
      ),
    )
    .leftJoin(ownerUser, eq(ownerMember.userId, ownerUser.id))
    .where(eq(schema.orgMembers.userId, user.id));

  const orgs = rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    plan: (r.ownerPlan ?? "free") as OrgPlan,
    qrLogo: r.qrLogo,
    qrStyle: r.qrStyle,
    qrColor: r.qrColor,
    qrCorner: r.qrCorner,
    qrBg: r.qrBg,
    qrEyeColor: r.qrEyeColor,
    qrLogoSize: r.qrLogoSize,
  }));
  return { user, orgs };
}

userRoutes.get("/user", requireUser, async (c) => {
  return c.json(await currentUserFor(c.var.db, c.var.user!));
});

// Public, non-secret deployment config (the SPA shows appHost in DNS setup
// instructions for custom domains).
userRoutes.get("/config", (c) => {
  return c.json({ appHost: c.env.APP_HOST } satisfies AppConfig);
});
