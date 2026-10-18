/**
 * What an admin, or a destination, can do to put links on hold (#334 follow-up).
 *
 * Kept apart from abuse.ts, which owns the sweep: this file imports from it,
 * never the other way round.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { blockHostOf, holdReasonFor } from "../shared/abuse-rules";
import type { OrgPlan } from "../shared/types";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { recordAdminAction } from "./audit";
import { captureAlert } from "./sentry";
import { republishOrgLinks } from "./storage";
import { notifyAdmin, notifyHold, suspendOrgLinks } from "./abuse";
import { RESERVED_SLUGS } from "./util";

/** Refuse a destination whose host an admin has blocked. Called from every
 * create and edit path, so a scam kit cannot be pointed at again from a new
 * account. 422, and the same words for every blocked host. */
export async function isBlockedHost(db: DB, destination: string): Promise<boolean> {
  const host = blockHostOf(destination);
  if (!host) return false;
  const rows = await db
    .select({ host: schema.blockedHosts.host })
    .from(schema.blockedHosts)
    .where(eq(schema.blockedHosts.host, host));
  return rows.length > 0;
}

export async function assertNotBlocked(db: DB, destination: string): Promise<void> {
  if (await isBlockedHost(db, destination))
    throw new HTTPException(422, { message: "That destination is not allowed on rdyrct." });
}

/**
 * Hold a new link whose destination looks like a scam: a brand name on a free
 * app host (see shared/abuse-rules). Returns the suspension columns to write
 * with the link, or null. Free orgs only; a paying org has been through
 * billing, and the hold is for the unattended free signup.
 *
 * The org is flagged for review so the hold shows up where an admin looks, and
 * the owner is told why. A hold is not a verdict: restoring it is one click.
 */
export async function holdIfSuspicious(
  env: Env,
  db: DB,
  orgId: string,
  plan: OrgPlan,
  destination: string,
) {
  if (plan !== "free") return null;
  const reason = holdReasonFor(destination);
  if (!reason) return null;
  await db
    .update(schema.orgs)
    .set({ reviewFlaggedAt: Date.now() })
    .where(and(eq(schema.orgs.id, orgId), isNull(schema.orgs.reviewFlaggedAt)));
  captureAlert([{ event: "link_held", orgId, reason }]);
  // The owner hears that it was paused and how to answer, not which word did
  // it; the admin gets the specific reason.
  await notifyHold(
    env,
    db,
    orgId,
    "A link is on hold",
    "One of your links looks like it may imitate another site, so we paused it until somebody has looked.",
  );
  await notifyAdmin(
    env,
    "A link was held at creation",
    [reason, `Organization ${orgId}.`],
    "/admin/orgs",
  );
  return { suspendedAt: Date.now(), suspendedBy: null, suspendReason: reason };
}

/**
 * Refuse a destination that is another rdyrct short link. Chaining through
 * one launders the real destination past the hold and the risk check: the
 * first link looks clean, and the second is somebody else's. Our own site and
 * its pages stay allowed, so a link to /pricing is fine and /abc1234 is not.
 */
export function assertNotOwnShortLink(env: Env, destination: string): void {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return;
  }
  const host = url.host.toLowerCase();
  const shortHost = env.SHARED_LINK_HOST?.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const onShortHost = shortHost !== undefined && host === shortHost;
  const onAppHost = host === env.APP_HOST?.toLowerCase();
  const looksLikeSlug = segments.length === 1 && !RESERVED_SLUGS.has(segments[0].toLowerCase());
  if (onShortHost || (onAppHost && looksLikeSlug))
    throw new HTTPException(422, { message: "A link cannot point at another rdyrct short link." });
}

/* ---------------- banned users ---------------- */

/** The reason every link of a banned user's orgs carries, so unbanning
 * restores exactly those and not what an admin suspended for another reason. */
const BAN_REASON = "Owner banned";

async function ownedOrgIds(db: DB, userId: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.userId, userId), eq(schema.orgMembers.role, "owner")));
  return rows.map((r) => r.orgId);
}

/**
 * Banning a user stops their sessions, but their links kept redirecting: the
 * scam went on while the account was shut. Suspend every org they own as well.
 * Reversible (see restoreBannedUserOrgs), and it leaves orgs they only belong
 * to alone: those have another owner who did nothing.
 */
export async function suspendBannedUserOrgs(env: Env, db: DB, userId: string, actorId: string) {
  const orgIds = await ownedOrgIds(db, userId);
  await Promise.all(orgIds.map((id) => suspendOrgLinks(env, db, id, actorId, BAN_REASON)));
  return orgIds.length;
}

/** Undo suspendBannedUserOrgs for links still carrying its reason, and lift an
 * org's block once none of its links is suspended. */
export async function restoreBannedUserOrgs(env: Env, db: DB, userId: string) {
  const orgIds = await ownedOrgIds(db, userId);
  await Promise.all(
    orgIds.map(async (orgId) => {
      await db
        .update(schema.links)
        .set({ suspendedAt: null, suspendedBy: null, suspendReason: null })
        .where(and(eq(schema.links.orgId, orgId), eq(schema.links.suspendReason, BAN_REASON)));
      await db
        .update(schema.orgs)
        .set({
          linksSuspendedAt: sql`case when exists (
            select 1 from links where links.org_id = ${orgId} and links.suspended_at is not null
          ) then links_suspended_at else null end`,
        })
        .where(and(eq(schema.orgs.id, orgId), isNotNull(schema.orgs.linksSuspendedAt)));
      await republishOrgLinks(env, db, orgId);
    }),
  );
}

/* ---------------- the "abuse" decision ---------------- */

/**
 * The admin's verdict that an org is abuse: its links stop, its owner is
 * banned, and every destination host it used is blocked so the same site
 * cannot be linked again from another account. One decision, three effects,
 * because doing only the first leaves the second and third for the next signup.
 */
export async function markOrgAbuse(
  env: Env,
  db: DB,
  orgId: string,
  actorId: string,
  reason: string,
) {
  const grounds = `Abuse: ${reason}`;
  const [[owner], destinations] = await Promise.all([
    db
      .select({ userId: schema.orgMembers.userId })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, "owner"))),
    db
      .select({ destination: schema.links.destination })
      .from(schema.links)
      .where(eq(schema.links.orgId, orgId)),
  ]);
  const hosts = [
    ...new Set(destinations.map((d) => blockHostOf(d.destination)).filter((h) => h !== null)),
  ];

  const suspended = await suspendOrgLinks(env, db, orgId, actorId, grounds);
  await db
    .update(schema.orgs)
    .set({ reviewFlaggedAt: null, clearedAt: null })
    .where(eq(schema.orgs.id, orgId));
  if (owner) {
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, owner.userId));
    await db.delete(schema.session).where(eq(schema.session.userId, owner.userId));
  }
  if (hosts.length > 0)
    await db
      .insert(schema.blockedHosts)
      .values(
        hosts.map((host) => ({ host, reason: grounds, createdBy: actorId, createdAt: Date.now() })),
      )
      .onConflictDoNothing();

  await recordAdminAction(env, {
    actorUserId: actorId,
    action: "org.abuse",
    targetType: "org",
    targetId: orgId,
    detail: { reason, links: suspended, hostsBlocked: hosts.length, ownerBanned: !!owner },
  });
  return { links: suspended, hostsBlocked: hosts.length, ownerBanned: !!owner };
}
