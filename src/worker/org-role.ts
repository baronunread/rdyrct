import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { AppEnv, DB, SessionUser } from "./env";
import type { OrgRole } from "@/shared/types";

const ROLE_RANK = { member: 0, admin: 1, owner: 2 } satisfies Record<OrgRole, number>;

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

export function requireOrgRole(min: OrgRole, opts?: { allowWhileDeleting?: boolean }) {
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
    // workflow's gather step. See deleteOrg in routes/orgs.ts. The delete
    // route itself opts out: deleteOrg already makes a repeat DELETE a
    // no-op, and blocking it here would surface that as a 409 instead.
    if (!opts?.allowWhileDeleting && c.req.method !== "GET" && (await orgDeleting(c.var.db, orgId)))
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
