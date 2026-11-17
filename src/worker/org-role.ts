import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { AppEnv, DB, SessionUser } from "./env";
import type { OrgRole } from "@/shared/types";

const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 } satisfies Record<OrgRole, number>;

export async function orgRole(db: DB, user: SessionUser, orgId: string): Promise<OrgRole | null> {
  if (user.isAdmin) return "owner";
  const rows = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, user.id)));
  return rows[0]?.role ?? null;
}

export function requireOrgRole(
  min: OrgRole,
  opts?: { allowWhileDeleting?: boolean; allowWhileLocked?: boolean },
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) throw new HTTPException(401, { message: "Not signed in" });
    const orgId = c.req.param("orgId");
    if (!orgId) throw new HTTPException(400, { message: "Missing org id" });
    const role = await orgRole(c.var.db, user, orgId);
    if (!role || ROLE_RANK[role] < ROLE_RANK[min])
      throw new HTTPException(403, { message: "Insufficient role" });
    if (c.req.method !== "GET") await assertOrgWritable(c.var.db, orgId, opts);
    await next();
  });
}

/**
 * Teardown: a link or domain created in that window would be missed by the workflow's gather
 * step. The delete route opts out (deleteOrg is idempotent). Suspended (#224) has no opt-out,
 * or a link-creation route could mint a replacement before the next sweep.
 */
async function assertOrgWritable(
  db: DB,
  orgId: string,
  opts?: { allowWhileDeleting?: boolean; allowWhileLocked?: boolean },
): Promise<void> {
  const state = await orgState(db, orgId);
  if (!opts?.allowWhileDeleting && state.deletingAt != null)
    throw new HTTPException(409, { message: "Organization is being deleted" });
  if (!opts?.allowWhileLocked && state.lockedAt != null)
    throw new HTTPException(403, {
      message: "This organization is locked: upgrade to Pro to use it again",
      cause: { code: "org_locked" },
    });
  // A banned owner's org may be both, and the ban is the reason nothing changes.
  if (state.disabledAt != null)
    throw new HTTPException(403, {
      message: "This organization is disabled: its owner is banned.",
      cause: { code: "org_disabled" },
    });
  if (state.linksSuspendedAt != null)
    throw new HTTPException(403, {
      message: "This organization's links are suspended.",
      cause: { code: "org_suspended" },
    });
}

async function orgState(
  db: DB,
  orgId: string,
): Promise<{
  deletingAt: number | null;
  lockedAt: number | null;
  linksSuspendedAt: number | null;
  disabledAt: number | null;
}> {
  const rows = await db
    .select({
      deletingAt: schema.orgs.deletingAt,
      lockedAt: schema.orgs.lockedAt,
      linksSuspendedAt: schema.orgs.linksSuspendedAt,
      disabledAt: schema.orgs.disabledAt,
    })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  return rows[0] ?? { deletingAt: null, lockedAt: null, linksSuspendedAt: null, disabledAt: null };
}

/** Same state read as the route middleware, so locked and deleting cannot drift. */
export async function orgDeleting(db: DB, orgId: string): Promise<boolean> {
  return (await orgState(db, orgId)).deletingAt != null;
}

/** An upload can outlive the middleware's state read: re-check so teardown leaves no object behind. */
export async function orgPresentAndNotDeleting(db: DB, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ deletingAt: schema.orgs.deletingAt })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  return rows[0]?.deletingAt === null;
}
