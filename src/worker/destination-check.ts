/**
 * What a Google Web Risk hit does to a link (#341).
 *
 * risk.ts scores; this acts. A hit says something about the account as well
 * as the link, and how far it reaches depends on the account:
 *
 *  - A new free org (under seven days): every link it has is held, the same
 *    as the sweep's hold. An account days old pointing at a listed site is
 *    most likely a scammer, and its other links are probably bad too.
 *  - An older or paid org: that link alone is held and the org is flagged.
 *    A hit on an established account is more often a site that was hacked
 *    than a scammer.
 *
 * Checked on create and edit (in waitUntil, after the response), and weekly
 * for every live free-plan link, because a kit often goes bad after the link
 * is made. Unset WEB_RISK_API_KEY and none of this runs.
 */
import { and, asc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createLogger, type AuditableLogger } from "evlog";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import {
  flagForReview,
  NEW_ORG_WINDOW_MS,
  notifyAdmin,
  notifyHold,
  suspendOrgLinks,
} from "./abuse";
import { recordAdminAction } from "./audit";
import { billingEnabled, orgPlan } from "./plan";
import { askWebRisk, isWebRiskHit, scoreAndRecord, webRiskThreats, type RiskVerdict } from "./risk";
import { captureAlert } from "./sentry";
import { republishLink } from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Score a link's destination and hold it on a Web Risk hit. Meant for
 * `waitUntil` on create and edit: nobody waits on it, and every failure is
 * swallowed, because a link must never fail to save over a lookup.
 *
 * Its own wide event, not the request's: that one is emitted with the
 * response, before this runs. It carries the link id and what Web Risk said,
 * never the destination.
 */
export async function checkLinkDestination(
  env: Env,
  link: { id: string; orgId: string; destination: string },
): Promise<void> {
  const linkId = link.id;
  const log = createLogger({ operation: "link.destination_check", link: { id: linkId } });
  const db = drizzle(env.DB, { schema });
  try {
    const { verdict, webRisk } = await scoreAndRecord(env, linkId, link.destination, "links", () =>
      spendWebRiskLookup(db, link.orgId),
    );
    log.set({ webRisk: { outcome: webRisk } });
    if (webRisk === "failed") log.warn("Web Risk did not answer");
    if (!verdict || !isWebRiskHit(verdict)) return;
    try {
      await holdForWebRisk(env, db, linkId, verdict);
    } catch (error) {
      log.set({ webRisk: { hold: "failed" } });
      log.error(error instanceof Error ? error : String(error));
      await retryWebRiskTomorrow(db, linkId);
    }
  } finally {
    log.emit();
  }
}

/**
 * Web Risk lookups one org's link creates and edits may spend in a UTC day.
 * Each destination edit is a lookup, so without this, flipping one link
 * between two URLs at the write rate limit spends more in a day than the
 * free tier allows in a month, and after that every lookup fails open for
 * everybody. The cache (risk.ts) makes a repeated URL free; this caps how
 * many different ones an org can make us ask about. Past it, the link is
 * left unstamped, so the rescan takes it first.
 */
export const WEB_RISK_LOOKUPS_PER_ORG_PER_DAY = 200;

/**
 * Count one Web Risk lookup against the org's day, or return false when the
 * day is spent. One conditional write, so two requests racing cannot both
 * take the last lookup. A new UTC day starts the count again.
 */
async function spendWebRiskLookup(db: DB, orgId: string): Promise<boolean> {
  const day = Math.floor(Date.now() / DAY_MS);
  const spent = await db
    .update(schema.orgs)
    .set({
      webRiskDay: day,
      webRiskLookups: sql`case when ${schema.orgs.webRiskDay} = ${day} then coalesce(${schema.orgs.webRiskLookups}, 0) + 1 else 1 end`,
    })
    .where(
      and(
        eq(schema.orgs.id, orgId),
        or(
          isNull(schema.orgs.webRiskDay),
          ne(schema.orgs.webRiskDay, day),
          lt(sql`coalesce(${schema.orgs.webRiskLookups}, 0)`, WEB_RISK_LOOKUPS_PER_ORG_PER_DAY),
        ),
      ),
    )
    .returning({ id: schema.orgs.id });
  return spent.length > 0;
}

/** How soon the rescan asks again about a link whose lookup or hold failed. */
const RETRY_AFTER_MS = DAY_MS;

/**
 * Stamp a link so the rescan asks again after RETRY_AFTER_MS, not after the
 * full week. Used when Google did not answer, and when a hold failed after
 * the stamp landed. Not null, which sorts first: a link that fails every time
 * (a Google outage, a hold that keeps throwing) would then take a slot every
 * day ahead of every link that has never been checked. A held link is left
 * alone: the rescan skips it anyway. Swallows its own failure, since it is
 * already the recovery path.
 */
async function retryWebRiskTomorrow(db: DB, linkId: string): Promise<void> {
  await db
    .update(schema.links)
    .set({ webRiskCheckedAt: Date.now() - RESCAN_EVERY_MS + RETRY_AFTER_MS })
    .where(and(eq(schema.links.id, linkId), isNull(schema.links.suspendedAt)))
    .catch(() => {});
}

/** Hold a link Web Risk lists, and its whole org when the org is new and
 * free. A link already held is left alone, so a repeat hit is a no-op. */
async function holdForWebRisk(
  env: Env,
  db: DB,
  linkId: string,
  verdict: RiskVerdict,
): Promise<void> {
  const [link] = await db
    .select({
      orgId: schema.links.orgId,
      suspendedAt: schema.links.suspendedAt,
      orgCreatedAt: schema.orgs.createdAt,
    })
    .from(schema.links)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.links.orgId))
    .where(eq(schema.links.id, linkId));
  if (!link || link.suspendedAt !== null) return;
  const { plan } = await orgPlan(db, link.orgId);
  const reason = `Google Web Risk lists the destination (${webRiskThreats(verdict).join(", ")}).`;
  const adminPath = `/admin/links?org=${encodeURIComponent(link.orgId)}`;

  if (plan === "free" && Date.now() - link.orgCreatedAt < NEW_ORG_WINDOW_MS) {
    const held = await suspendOrgLinks(env, db, link.orgId, null, reason);
    if (held === 0) return;
    captureAlert([{ event: "web_risk_hit", orgId: link.orgId, linkId, scope: "org", links: held }]);
    await notifyAdmin(
      env,
      "Held: a new free org links to a site Google lists",
      [
        reason,
        `Organization ${link.orgId} is under seven days old, so all ${held} of its links are held.`,
      ],
      adminPath,
    );
    await notifyHold(
      env,
      db,
      link.orgId,
      "Your links are on hold",
      "One of your links points at a site that Google lists as harmful, so we paused your links until somebody has looked.",
    ).catch(() => {});
    return;
  }

  const held = await db
    .update(schema.links)
    .set({ suspendedAt: Date.now(), suspendedBy: null, suspendReason: reason })
    .where(and(eq(schema.links.id, linkId), isNull(schema.links.suspendedAt)))
    .returning({ id: schema.links.id });
  if (held.length === 0) return;
  // After the flag is written, so a sync consumed early cannot read the old
  // value: the hold is enforced in storage.ts's desiredLink.
  await republishLink(env, db, linkId);
  await flagForReview(db, link.orgId);
  await recordAdminAction(env, {
    actorUserId: "system",
    action: "link.suspend",
    targetType: "link",
    targetId: linkId,
    detail: { orgId: link.orgId, reason },
  });
  captureAlert([{ event: "web_risk_hit", orgId: link.orgId, linkId, scope: "link", links: 1 }]);
  await notifyAdmin(
    env,
    "Held: a link to a site Google lists",
    [reason, `Organization ${link.orgId}. Only this link is held; the org is flagged for review.`],
    adminPath,
  );
  await notifyHold(
    env,
    db,
    link.orgId,
    "A link is on hold",
    "One of your links points at a site that Google lists as harmful, so we paused it until somebody has looked. If the site is yours, it may have been hacked.",
  ).catch(() => {});
}

/* ---------------- the weekly rescan ---------------- */

/** How often a live free-plan link is looked at again. */
const RESCAN_EVERY_MS = 7 * DAY_MS;

/**
 * Links per daily run. Each is one Web Risk lookup and one D1 write, and the
 * daily cron shares its subrequest budget with every other sweep.
 *
 * ponytail: 150 a day covers about a thousand live free links a week. Past
 * that, the oldest-checked go first and the rest wait their turn; raise it
 * (the free tier is 100,000 lookups a month) or run it more often then.
 */
export const WEB_RISK_RESCAN_BATCH = 150;
/** Lookups in flight at once, so one slow answer does not stall the batch
 * and a full one does not open 150 connections together. */
const RESCAN_CONCURRENCY = 10;

/**
 * Look again at the live free-plan links Web Risk has not seen for a week,
 * oldest first, and hold any it now lists. Paid links are checked when made
 * and edited only: their owners went through billing. Returns how many links
 * Web Risk answered for.
 */
export async function rescanFreeLinks(env: Env): Promise<number> {
  // No billing means no free plan: every org is unlimited (plan.ts).
  if (!env.WEB_RISK_API_KEY || !billingEnabled()) return 0;
  const db = drizzle(env.DB, { schema });
  const due = await db
    .select({ id: schema.links.id, destination: schema.links.destination })
    .from(schema.links)
    .innerJoin(
      schema.orgMembers,
      and(eq(schema.orgMembers.orgId, schema.links.orgId), eq(schema.orgMembers.role, "owner")),
    )
    .innerJoin(schema.user, eq(schema.user.id, schema.orgMembers.userId))
    .where(
      and(
        isNull(schema.links.suspendedAt),
        eq(schema.user.plan, "free"),
        or(
          isNull(schema.links.webRiskCheckedAt),
          lt(schema.links.webRiskCheckedAt, Date.now() - RESCAN_EVERY_MS),
        ),
      ),
    )
    .orderBy(sql`${schema.links.webRiskCheckedAt} is not null`, asc(schema.links.webRiskCheckedAt))
    .limit(WEB_RISK_RESCAN_BATCH);

  // One wide event for the run, with a count per outcome: a Google outage
  // shows up as one `failed` number, not 150 warnings.
  const log = createLogger({ operation: "web_risk.rescan" });
  const counts = { hit: 0, clean: 0, failed: 0, error: 0 } satisfies Record<RescanOutcome, number>;
  try {
    for (let i = 0; i < due.length; i += RESCAN_CONCURRENCY) {
      const results = await Promise.all(
        due.slice(i, i + RESCAN_CONCURRENCY).map((link) => rescanOne(env, db, link, log)),
      );
      for (const outcome of results) counts[outcome] += 1;
    }
  } finally {
    log.set({ webRisk: { rescan: { due: due.length, ...counts } } });
    if (counts.failed > 0) log.warn("Web Risk did not answer for some links");
    log.emit();
  }
  return counts.hit + counts.clean;
}

/** What one link of the rescan came to: Web Risk's answer, no answer
 * (`failed`), or a throw on our side after it answered (`error`). */
type RescanOutcome = "hit" | "clean" | "failed" | "error";

/**
 * One link of the rescan. Web Risk alone: the DNS check already runs on every
 * click (risk.ts's revalidateOnRedirect), so asking it again here would spend
 * the subrequests for nothing. A clean answer only stamps the date, so it
 * never overwrites a DNS block with a zero.
 */
async function rescanOne(
  env: Env,
  db: DB,
  link: { id: string; destination: string },
  log: AuditableLogger,
): Promise<RescanOutcome> {
  try {
    const { verdict } = await askWebRisk(env, link.destination);
    if (!verdict) {
      // Stamped anyway, so a link Google never answers for cannot keep its
      // place at the front of the queue and take every daily slot.
      await retryWebRiskTomorrow(db, link.id);
      return "failed";
    }
    const now = Date.now();
    const hit = isWebRiskHit(verdict);
    const written = await db
      .update(schema.links)
      .set({
        webRiskCheckedAt: now,
        ...(hit && {
          riskScore: verdict.score,
          riskReasons: JSON.stringify(verdict.reasons),
          riskCheckedAt: now,
          riskProvider: verdict.provider,
        }),
      })
      // Only if it still points where the lookup went (see scoreAndRecord).
      .where(and(eq(schema.links.id, link.id), eq(schema.links.destination, link.destination)))
      .returning({ id: schema.links.id });
    if (hit && written.length > 0) await holdForWebRisk(env, db, link.id, verdict);
    return hit ? "hit" : "clean";
  } catch (error) {
    log.error(error instanceof Error ? error : String(error));
    // The stamp above may have landed before the hold threw.
    await retryWebRiskTomorrow(db, link.id);
    return "error";
  }
}
