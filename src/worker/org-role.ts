import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { AppEnv, DB, SessionUser } from "./env";
import type { OrgRole } from "@/shared/types";

/** Least to most powerful. `requireOrgRole(min)` compares against this, so a
 * route's minimum is the whole of its authorization: a GET every member may
 * read asks for "viewer", a write asks for "member". */
const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 } satisfies Record<OrgRole, number>;

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
 * The three states that stop an org accepting writes while leaving its reads
 * open. All are checked here rather than in each route, for the same
 * reason: no route has to remember.
 *
 * Teardown: a link or domain created in that window would be missed by the
 * workflow's gather step. The delete route itself opts out, because
 * deleteOrg already makes a repeat DELETE a no-op and blocking it here would
 * surface that as a 409 instead.
 *
 * Locked: the org is beyond its owner's plan (#160), so it keeps serving its
 * links and accepts no changes, its owner included.
 *
 * Suspended: abuse.ts's sweep or an admin suspended every link in the org
 * (#224). No opt-out: a link-creation route without this check is exactly
 * how an org whose links were just suspended could mint a replacement before
 * the next pass caught it.
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
}> {
  const rows = await db
    .select({
      deletingAt: schema.orgs.deletingAt,
      lockedAt: schema.orgs.lockedAt,
      linksSuspendedAt: schema.orgs.linksSuspendedAt,
    })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  return rows[0] ?? { deletingAt: null, lockedAt: null, linksSuspendedAt: null };
}

/** The statement-level link guards need to distinguish teardown from a cap
 * refusal after the insert writes nothing. Reuse the same state read as the
 * route middleware so locked and deleting behavior cannot drift. */
export async function orgDeleting(db: DB, orgId: string): Promise<boolean> {
  return (await orgState(db, orgId)).deletingAt != null;
}

/** An upload can outlive the route middleware's state read. Re-check after
 * the R2 write so teardown cannot leave an object behind after deleting the
 * org's prefix. A missing org is no longer writable either. */
export async function orgPresentAndNotDeleting(db: DB, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ deletingAt: schema.orgs.deletingAt })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  return rows[0]?.deletingAt === null;
}
