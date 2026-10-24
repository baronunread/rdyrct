/**
 * The warning tier (#344): a link that still works, behind a page that names
 * the destination's host and asks the visitor to continue. Bitly's model: a
 * warning for links that are only suspicious, and a hold for links where a
 * visit does harm.
 *
 * Set automatically by an open report on the link and by the abuse sweep for
 * a new free org with unusual traffic, and by an admin in one click. The
 * state lives on the link row and reaches the redirect path through the KV
 * value (storage.ts's desiredLink), so every write here ends in a republish.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { republishLink, republishOrgLinks } from "./storage";

/** Why a link carries a warning. For the admin; no visitor ever sees it. */
export const WARN_REASON = {
  report: "Open report",
  traffic: "Unusual traffic on a new free organization",
  admin: "Set by an admin",
} as const;

/** The reasons a person did not choose. Clearing a review clears these and
 * leaves an admin's own warning in place. */
const AUTOMATIC_REASONS = [WARN_REASON.report, WARN_REASON.traffic];

/**
 * Put a warning on one link. A held link is left alone: it already serves
 * nothing, and a warning on it would read as a lighter verdict after the
 * hold is lifted. Returns whether anything changed, so a caller acting on
 * the first warning only (a mail, an alert) can tell.
 */
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

/**
 * Take the warning off one link. With `onlyReason`, only a warning set for
 * that reason: dismissing the last report on a link lifts the warning the
 * report put there, not one an admin chose.
 */
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

/** Warn every live link in an org, and mark the org so the links it makes
 * from now on are born warned (orgLinkWarning). Returns how many links it
 * warned: zero means they already were, which is what makes a repeat sweep a
 * no-op. */
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

/** An admin marked the org reviewed: lift every warning an automatic check
 * put on its links, and the org mark that warns the links it makes next. */
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

/**
 * The warning a link made in this org right now is born with, or null. Set
 * while the sweep has the org warned: without it, an org whose links show the
 * warning page could make new ones that redirect straight through.
 */
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
