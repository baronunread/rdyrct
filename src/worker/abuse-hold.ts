/**
 * What an admin, or a destination, can do to put links on hold (#334 follow-up).
 *
 * Kept apart from abuse.ts, which owns the sweep: this file imports from it,
 * never the other way round.
 */
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { blockable, blockHostOf, holdReasonFor } from "../shared/abuse-rules";
import type { OrgPlan } from "../shared/types";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { captureAlert } from "./sentry";
import { publishOrgSyncs, queueOrgSyncs } from "./storage";
import { endSubscriptionBeforeDelete } from "./routes/billing";
import { startOrgTeardown } from "./routes/orgs";
import { flagForReview, notifyAdmin, notifyHold } from "./abuse";
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
  await flagForReview(db, orgId);
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

/** How long a banned owner's orgs answer "disabled" before the daily cron
 * deletes them: long enough for a mistaken ban to be undone, and for the
 * people who still click an old text or scan an old code to be told. */
export const BAN_PURGE_AFTER_DAYS = 90;
const BAN_PURGE_AFTER_MS = BAN_PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
/** Orgs one daily pass sends to teardown. Bounded like every other sweep. */
const BAN_PURGE_LIMIT = 50;

async function ownedOrgIds(db: DB, userId: string): Promise<string[]> {
  const rows = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.userId, userId), eq(schema.orgMembers.role, "owner")));
  return rows.map((r) => r.orgId);
}

/** Every destination host in the orgs a user owns, and whether a ban may
 * block it. What the ban dialog lists before anything is blocked. */
export async function ownedDestinationHosts(
  db: DB,
  userId: string,
): Promise<{ host: string; blockable: boolean }[]> {
  const orgIds = await ownedOrgIds(db, userId);
  if (orgIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ destination: schema.links.destination })
    .from(schema.links)
    .where(inArray(schema.links.orgId, orgIds));
  const hosts = new Set(rows.map((r) => blockHostOf(r.destination)).filter((h) => h !== null));
  return [...hosts].sort().map((host) => ({ host, blockable: blockable(host) }));
}

/**
 * The decision that a user is abuse. Their sessions end and they cannot sign
 * in. Every org they own is disabled: each link and custom domain answers
 * "disabled", nobody can change it, and the daily cron deletes the org
 * BAN_PURGE_AFTER_DAYS later. A subscription is revoked, so a banned account
 * stops paying. Orgs they only belong to are untouched: those have an owner
 * who did nothing.
 *
 * Hosts are blocked only when the admin picks them, from the ones the user
 * linked to, and never one on the NEVER_BLOCKED list: most scam kits live on
 * a throwaway address that will not come back, and a host on the blocklist
 * is refused for every customer.
 */
export async function banUser(
  env: Env,
  db: DB,
  userId: string,
  actorId: string,
  opts: { reason: string; blockHosts: string[] },
) {
  const now = Date.now();
  const orgIds = await ownedOrgIds(db, userId);
  const banned = db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, userId));
  const signedOut = db.delete(schema.session).where(eq(schema.session.userId, userId));
  let synced: { id: string; orgId: string }[] = [];
  if (orgIds.length === 0) await db.batch([banned, signedOut]);
  else {
    const owned = inArray(schema.orgs.id, orgIds);
    // One batch, so the orgs are never disabled without the outbox rows that
    // publish it. Every owned org is queued, not only the ones this disables,
    // so a repeated ban repairs whatever an earlier one left unpublished.
    const [, , rows] = await db.batch([
      banned,
      signedOut,
      queueOrgSyncs(db, and(owned, isNull(schema.orgs.deletingAt))),
      db
        .update(schema.orgs)
        // reviewFlaggedAt: the ban answers whatever flag was waiting.
        .set({ disabledAt: now, reviewFlaggedAt: null })
        .where(and(owned, isNull(schema.orgs.disabledAt))),
    ]);
    synced = rows;
  }
  await publishOrgSyncs(env, db, synced);

  // Before the hosts: a Polar outage must not leave a scammer's links live,
  // and a blocklist failure must not leave them paying. It is alerted on,
  // and the admin is told to end it by hand.
  const subscriptionEnded = await endSubscriptionBeforeDelete(env, userId);

  let hostsBlocked = 0;
  let hostsFailed = false;
  try {
    hostsBlocked = await blockBannedHosts(db, userId, actorId, opts, now);
  } catch (error) {
    // The ban stands and the admin's audit row still gets written; the
    // dialog says to add the hosts by hand.
    hostsFailed = true;
    captureAlert([
      {
        event: "ban_hosts_failed",
        userId,
        error: error instanceof Error ? error.message.slice(0, 200) : "",
      },
    ]);
  }
  return { orgsDisabled: orgIds.length, hostsBlocked, hostsFailed, subscriptionEnded };
}

/** blocked_hosts binds four values a row, and D1 allows 100 a statement. */
const BLOCKED_HOSTS_PER_INSERT = 24;

/** Adds the hosts the admin picked, of the ones the user linked to that may
 * be blocked, in one batch. Returns how many it was asked to add. */
async function blockBannedHosts(
  db: DB,
  userId: string,
  actorId: string,
  opts: { reason: string; blockHosts: string[] },
  now: number,
): Promise<number> {
  const offered = new Set(
    (await ownedDestinationHosts(db, userId)).filter((h) => h.blockable).map((h) => h.host),
  );
  const rows = [...new Set(opts.blockHosts)]
    .filter((host) => offered.has(host))
    .map((host) => ({ host, reason: `Ban: ${opts.reason}`, createdBy: actorId, createdAt: now }));
  const inserts = [];
  for (let i = 0; i < rows.length; i += BLOCKED_HOSTS_PER_INSERT)
    inserts.push(
      db
        .insert(schema.blockedHosts)
        .values(rows.slice(i, i + BLOCKED_HOSTS_PER_INSERT))
        .onConflictDoNothing(),
    );
  const [first, ...rest] = inserts;
  if (first) await db.batch([first, ...rest]);
  return rows.length;
}

/** Undo banUser for the orgs not yet deleted. Blocked hosts stay blocked
 * (they have their own page) and a revoked subscription stays revoked.
 * Returns how many orgs it brought back. */
export async function unbanUser(env: Env, db: DB, userId: string): Promise<number> {
  const orgIds = await ownedOrgIds(db, userId);
  const unbanned = db.update(schema.user).set({ banned: false }).where(eq(schema.user.id, userId));
  if (orgIds.length === 0) {
    await unbanned;
    return 0;
  }
  // An org the purge has started on stays disabled: teardown is deleting its
  // KV keys, and a republish racing it could put live ones back.
  const restorable = and(
    inArray(schema.orgs.id, orgIds),
    isNotNull(schema.orgs.disabledAt),
    isNull(schema.orgs.deletingAt),
  );
  // One batch, for the same reason as banUser's. The outbox rows go first,
  // while `restorable` still matches the orgs the update is about to change.
  const [, rows, restored] = await db.batch([
    unbanned,
    queueOrgSyncs(db, restorable),
    db
      .update(schema.orgs)
      .set({ disabledAt: null })
      .where(restorable)
      .returning({ id: schema.orgs.id }),
  ]);
  await publishOrgSyncs(env, db, rows);
  return restored.length;
}

/**
 * Deletes the orgs of owners banned more than BAN_PURGE_AFTER_DAYS ago:
 * links, KV keys, clicks, domains and logos, through the same teardown as a
 * deletion an owner asks for. The user row stays, banned, so the address
 * cannot sign up again. Returns how many orgs it started on.
 *
 * Picks and marks the orgs in one statement. Read first and marked after,
 * an unban landing in between would see an org not yet deleting, restore
 * it, and then lose it to a teardown nobody wanted.
 */
export async function purgeBannedOrgs(env: Env, db: DB, now = Date.now()): Promise<number> {
  const due = and(
    isNotNull(schema.orgs.disabledAt),
    lt(schema.orgs.disabledAt, now - BAN_PURGE_AFTER_MS),
    isNull(schema.orgs.deletingAt),
  );
  const marked = await db
    .update(schema.orgs)
    .set({ deletingAt: now })
    .where(
      and(
        due,
        // SQLite on D1 has no UPDATE ... LIMIT; the bound goes on a subquery.
        inArray(
          schema.orgs.id,
          db.select({ id: schema.orgs.id }).from(schema.orgs).where(due).limit(BAN_PURGE_LIMIT),
        ),
      ),
    )
    .returning({ id: schema.orgs.id });
  const ids = marked.map((org) => org.id);
  await startOrgTeardown(db, env, ids, ids);
  return ids.length;
}

/**
 * What migration 0046 could not do itself, run by the daily cron. A
 * migration cannot reach KV, and it runs before the new Worker is deployed:
 * an old Worker's drain would drop an `org_sync` row it does not know, and
 * an old Worker's KV sync would publish links live the moment their old
 * "Owner banned" suspension went. So the suspensions go here, after deploy.
 *
 * Every step matches only rows still in the old state, so it changes
 * nothing once that is gone:
 * - an org whose owner is banned and that has no `disabled_at` (an old
 *   Worker banned them during the deploy) is disabled;
 * - a disabled org whose owner is no longer banned (an old Worker unbanned
 *   them during the deploy) is restored and republished, or the purge
 *   would delete it. Nothing else leaves an org disabled under an unbanned
 *   owner: this Worker's unban clears `disabled_at`;
 * - the "Owner banned" suspensions in disabled orgs are cleared, since
 *   `disabled_at` does that job and an unban clears it;
 * - a disabled org's `links_suspended_at` goes when no link in it is still
 *   suspended, or an unban would leave the org read-only;
 * - every disabled org not being deleted gets an `org_sync`, so KV shows
 *   the disabled page however it got there.
 */
export async function settleBannedOrgs(db: DB): Promise<void> {
  const disabled = isNotNull(schema.orgs.disabledAt);
  const disabledOrgIds = db.select({ id: schema.orgs.id }).from(schema.orgs).where(disabled);
  const ownedByBanned = (banned: boolean) =>
    inArray(
      schema.orgs.id,
      db
        .select({ id: schema.orgMembers.orgId })
        .from(schema.orgMembers)
        .innerJoin(schema.user, eq(schema.user.id, schema.orgMembers.userId))
        .where(and(eq(schema.orgMembers.role, "owner"), eq(schema.user.banned, banned))),
    );
  const unbannedButDisabled = and(disabled, isNull(schema.orgs.deletingAt), ownedByBanned(false));
  await db.batch([
    db
      .update(schema.orgs)
      .set({ disabledAt: Date.now() })
      .where(and(isNull(schema.orgs.disabledAt), ownedByBanned(true))),
    // Queued first, while the condition still matches the orgs it restores.
    queueOrgSyncs(db, unbannedButDisabled),
    db.update(schema.orgs).set({ disabledAt: null }).where(unbannedButDisabled),
    db
      .update(schema.links)
      .set({ suspendedAt: null, suspendedBy: null, suspendReason: null })
      .where(
        and(
          eq(schema.links.suspendReason, OLD_BAN_REASON),
          inArray(schema.links.orgId, disabledOrgIds),
        ),
      ),
    db
      .update(schema.orgs)
      .set({ linksSuspendedAt: null })
      .where(
        and(
          disabled,
          isNotNull(schema.orgs.linksSuspendedAt),
          sql`not exists (select 1 from links where links.org_id = ${schema.orgs.id} and links.suspended_at is not null)`,
        ),
      ),
    queueOrgSyncs(db, and(disabled, isNull(schema.orgs.deletingAt))),
  ]);
}

/** The reason the ban wrote on each link before migration 0046. */
const OLD_BAN_REASON = "Owner banned";
