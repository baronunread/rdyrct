// Bitly model: a warning for links that are only suspicious, a hold for links where a visit does harm (#344).
// The state lives on the link row and reaches the redirect path through the KV value (desiredLink), so every write ends in a republish.
import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { publishAnonLink, resolveSlug } from "./kv";
import { republishLink, republishOrgLinks } from "./storage";

export const WARN_REASON = {
  report: "Open report",
  traffic: "Unusual traffic on a new free organization",
  admin: "Set by an admin",
} as const;

// Reasons a person did not choose: clearing a review clears these and leaves an admin own warning in place.
const AUTOMATIC_REASONS = [WARN_REASON.report, WARN_REASON.traffic];

// A held link is left alone: a warning on it would read as a lighter verdict after the hold is lifted.
export async function warnLink(env: Env, db: DB, linkId: string, reason: string): Promise<boolean> {
  const changed = await db
    .update(schema.links)
    .set({ warnedAt: Date.now(), warnReason: reason })
    .where(
      and(
        eq(schema.links.id, linkId),
        isNull(schema.links.warnedAt),
        isNull(schema.links.suspendedAt),
      ),
    )
    .returning({ id: schema.links.id });
  if (changed.length === 0) return false;
  await republishLink(env, db, linkId);
  return true;
}

// Nothing to republish: KV carries the warning, not its reason.
export async function adoptWarning(db: DB, linkId: string): Promise<boolean> {
  const changed = await db
    .update(schema.links)
    .set({ warnReason: WARN_REASON.admin })
    .where(and(eq(schema.links.id, linkId), inArray(schema.links.warnReason, AUTOMATIC_REASONS)))
    .returning({ id: schema.links.id });
  return changed.length > 0;
}

export async function clearLinkWarning(
  env: Env,
  db: DB,
  linkId: string,
  onlyReason?: string,
): Promise<boolean> {
  const changed = await db
    .update(schema.links)
    .set({ warnedAt: null, warnReason: null })
    .where(
      and(
        eq(schema.links.id, linkId),
        isNotNull(schema.links.warnedAt),
        onlyReason === undefined ? undefined : eq(schema.links.warnReason, onlyReason),
      ),
    )
    .returning({ id: schema.links.id });
  if (changed.length === 0) return false;
  await republishLink(env, db, linkId);
  return true;
}

// Zero means they already were, which makes a repeat sweep a no-op.
export async function warnOrgLinks(
  env: Env,
  db: DB,
  orgId: string,
  reason: string,
): Promise<number> {
  await db
    .update(schema.orgs)
    .set({ linksWarnedAt: Date.now(), linksWarnReason: reason })
    .where(and(eq(schema.orgs.id, orgId), isNull(schema.orgs.linksWarnedAt)));
  const changed = await db
    .update(schema.links)
    .set({ warnedAt: Date.now(), warnReason: reason })
    .where(
      and(
        eq(schema.links.orgId, orgId),
        isNull(schema.links.warnedAt),
        isNull(schema.links.suspendedAt),
      ),
    )
    .returning({ id: schema.links.id });
  if (changed.length > 0) await republishOrgLinks(env, db, orgId);
  return changed.length;
}

export async function clearOrgAutomaticWarnings(env: Env, db: DB, orgId: string): Promise<number> {
  await db
    .update(schema.orgs)
    .set({ linksWarnedAt: null, linksWarnReason: null })
    .where(eq(schema.orgs.id, orgId));
  const changed = await db
    .update(schema.links)
    .set({ warnedAt: null, warnReason: null })
    .where(and(eq(schema.links.orgId, orgId), inArray(schema.links.warnReason, AUTOMATIC_REASONS)))
    .returning({ id: schema.links.id });
  if (changed.length > 0) await republishOrgLinks(env, db, orgId);
  return changed.length;
}

// Set while the sweep has the org warned, or new links would redirect straight through.
export async function orgLinkWarning(
  db: DB,
  orgId: string,
): Promise<{ warnedAt: number; warnReason: string } | null> {
  const [org] = await db
    .select({ at: schema.orgs.linksWarnedAt, reason: schema.orgs.linksWarnReason })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  if (!org?.at) return null;
  return { warnedAt: Date.now(), warnReason: org.reason ?? WARN_REASON.traffic };
}

// No links row and no D1 fallback on the redirect path, so the write goes straight to its KV key.
// An expired or gone link is left alone: a put would bring its key back.
export async function warnAnonLink(env: Env, db: DB, anonId: string): Promise<boolean> {
  const [anon] = await db
    .select({
      id: schema.anonLinks.id,
      slug: schema.anonLinks.slug,
      destination: schema.anonLinks.destination,
      expiresAt: schema.anonLinks.expiresAt,
    })
    .from(schema.anonLinks)
    .where(and(eq(schema.anonLinks.id, anonId), gt(schema.anonLinks.expiresAt, Date.now())));
  if (!anon) return false;
  // Only if the key still belongs to this anonymous link: a claim since the read has republished the slug under the org link id (as forgetAnonLink guards its delete).
  const published = await resolveSlug(env, anon.slug, null);
  if (published && published.linkId !== anon.id) return false;
  await publishAnonLink(env, { ...anon, warned: true });
  return true;
}
