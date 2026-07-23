import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, DB, SessionUser } from "./env";
import type { OrgRole } from "@/shared/types";
import { getAuth } from "./better-auth";

/** Attaches db + user (from the BetterAuth session, if any) to context. */
export const withSession = createMiddleware<AppEnv>(async (c, next) => {
  const db = drizzle(c.env.DB, { schema });
  c.set("db", db);
  c.set("user", null);

  const session = await getAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (session) {
    c.set("user", {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      isAdmin: session.user.isAdmin ?? false,
      emailVerified: session.user.emailVerified,
      plan: (session.user.plan ?? "free") as "free" | "hobby" | "pro",
      polarSubscriptionCancelAtPeriodEnd: session.user.polarSubscriptionCancelAtPeriodEnd ?? false,
      polarSubscriptionCurrentPeriodEnd:
        (session.user.polarSubscriptionCurrentPeriodEnd as number | null) ?? null,
    } satisfies SessionUser);
  }
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) throw new HTTPException(401, { message: "Not signed in" });
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  // 404, not 403: non-admins shouldn't learn this surface exists at all.
  if (!c.var.user?.isAdmin) throw new HTTPException(404, { message: "Not found" });
  await next();
});

const ROLE_RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

/**
 * Resolves the caller's role in the :orgId route param. Platform admins pass
 * every check (they act as owner everywhere, like a cloud super admin).
 */
export async function orgRole(db: DB, user: SessionUser, orgId: string): Promise<OrgRole | null> {
  if (user.isAdmin) return "owner";
  const rows = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, user.id)));
  return rows[0]?.role ?? null;
}

export function requireOrgRole(min: OrgRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) throw new HTTPException(401, { message: "Not signed in" });
    const orgId = c.req.param("orgId");
    if (!orgId) throw new HTTPException(400, { message: "Missing org id" });
    const role = await orgRole(c.var.db, user, orgId);
    if (!role || ROLE_RANK[role] < ROLE_RANK[min])
      throw new HTTPException(403, { message: "Insufficient role" });
    // Reads stay allowed while an org tears down; only block writes, so a
    // link or domain created in that window is never missed by the teardown
    // workflow's gather step. See deleteOrg in routes/orgs.ts.
    if (c.req.method !== "GET" && (await orgDeleting(c.var.db, orgId)))
      throw new HTTPException(409, { message: "Organization is being deleted" });
    await next();
  });
}

async function orgDeleting(db: DB, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ deletingAt: schema.orgs.deletingAt })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  return rows[0]?.deletingAt != null;
}
