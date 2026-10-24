import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { sendEmail } from "./email";
import { NOTICE_FOOTER, renderEmail, SUPPORT_EMAIL } from "./email-layout";
import { isFreeHost } from "../shared/abuse-rules";
import { orgOwnerEmail, orgPlan } from "./plan";
import { recordAdminAction } from "./audit";
import { captureAlert } from "./sentry";
import { republishOrgLinks } from "./storage";
import { WARN_REASON, warnOrgLinks } from "./link-warning";

/**
 * Abuse controls the 2026-09-10 incident showed were missing
 * (docs/incidents/2026-09-10-queue-ops-exhaustion.md, #224). A free account
 * created two links pointing at other public URL shorteners and drove ~3,400
 * redirects in a day, which exhausted the Cloudflare Queues op cap. `risk.ts`
 * scored both destinations "Clean" because a redirector resolves fine.
 */

/* ---------------- no chaining another shortener ---------------- */

/**
 * Hosts that are themselves link shorteners or redirect services. Sending one
 * of our links to one of these hides the real destination from our risk check
 * and from whoever clicks, and has no legitimate use. Not exhaustive and never
 * will be: this is the cheap early catch, the redirect ceiling below is the
 * backstop that needs no list.
 */
const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "bitly.com",
  "bitly.cx",
  "j.mp",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "v.gd",
  "rebrand.ly",
  "cutt.ly",
  "rb.gy",
  "shorturl.at",
  "t.ly",
  "s.id",
  "short.io",
  "smsg.us",
  "lnkd.in",
  "trib.al",
  "shorte.st",
  "adf.ly",
]);

/** Whether `destination`'s host is a known shortener, exact or a subdomain. */
export function isShortenerDestination(destination: string): boolean {
  let host: string;
  try {
    host = new URL(destination).hostname.toLowerCase();
  } catch {
    return false;
  }
  return SHORTENER_HOSTS.has(host) || [...SHORTENER_HOSTS].some((h) => host.endsWith(`.${h}`));
}

/** Refuse a destination that is another shortener. Called from every create
 * path: organization links and the anonymous shortener. */
export function assertNotShortener(destination: string): void {
  if (isShortenerDestination(destination))
    throw new HTTPException(422, {
      message: "That destination is another link shortener. Point the link at the final URL.",
    });
}

/* ---------------- per-organization redirect ceiling ---------------- */

/**
 * A free organization past this many redirects in 24 hours raises an alert
 * and is flagged for review; a new one also gets a warning on its links
 * (#344). It is never suspended for it (#387): volume alone is not a verdict
 * about anything. Roughly 60x a normal day's whole platform volume, and well
 * under the point where click ingestion strains anything.
 *
 * ponytail: counted from the `clicks` table on the frequent cron, so it lags
 * a few minutes and undercounts by whatever the per-location click rate
 * limiter (RL_CLICK_RECORDING) dropped. Tighten when #50's durable limiter
 * lands.
 */
export const REDIRECT_CEILING_PER_DAY = 2_000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Only an org this new gets a warning on its links for volume alone; an older
 * one is alerted and flagged, and left for a human to look at.
 *
 * The ceiling counts *recorded* clicks on the public redirect path, which
 * anyone can drive: `RL_CLICK_RECORDING` allows 600/minute per org, so an
 * unauthenticated requester can clear 2,000 in about four minutes just by
 * hammering any org's public link. Suspending on raw volume would make our
 * own abuse control a way to take down a stranger's org -- point a flood at
 * their link and the sweep suspends the victim. That is why volume never
 * suspends anything (#387): a hold needs a signal about the destination or a
 * report. A brand-new org hitting the ceiling is the 2026-09-10 incident's
 * shape (an account minting abuse minutes after signup), so its links get
 * the warning page, which costs a scam most of its clicks and a real launch
 * one extra click. A long-standing org suddenly seeing volume is at least as
 * likely to be a link that went viral, and is a case for a human.
 */
export const NEW_ORG_WINDOW_MS = 7 * DAY_MS;

/** How long the automatic checks leave an org alone after an admin cleared
 * it. The same as the new-org window: past it the sweep only alerts anyway. */
const CLEARED_FOR_MS = NEW_ORG_WINDOW_MS;

/**
 * Suspend every currently-live link in an organization and republish so the
 * redirect path stops serving them. This is the automatic path; the manual
 * one is `POST /admin/links/orgs/:orgId/suspend`, which does the same select /
 * update / republish for both directions. Returns how many links it
 * suspended: zero means they were already suspended, which is what makes a
 * repeat call a no-op.
 */
export async function suspendOrgLinks(
  env: Env,
  db: DB,
  orgId: string,
  // The user who asked, or null when the sweep did: `links.suspended_by` is a
  // foreign key, so an automatic action leaves it null rather than inventing a
  // user row. The audit entry still names a "system" actor (that column is not
  // a foreign key).
  suspendedBy: string | null,
  reason: string,
): Promise<number> {
  // Set first and unconditionally: this is what stops the org minting a
  // replacement link the moment its existing ones go dark (requireOrgRole
  // reads it on every write), independent of how many link rows below
  // actually change on a given call.
  await db
    .update(schema.orgs)
    .set({ linksSuspendedAt: Date.now(), reviewFlaggedAt: null })
    .where(eq(schema.orgs.id, orgId));

  const live = and(eq(schema.links.orgId, orgId), isNull(schema.links.suspendedAt));
  const links = await db.select({ id: schema.links.id }).from(schema.links).where(live);
  if (links.length === 0) return 0;

  await db
    .update(schema.links)
    .set({ suspendedAt: Date.now(), suspendedBy, suspendReason: reason })
    .where(live);
  // After the flag is written, so a message consumed early cannot read the old
  // value: suspension is enforced in storage.ts's desiredKvValue.
  await republishOrgLinks(env, db, orgId);
  await recordAdminAction(env, {
    actorUserId: suspendedBy ?? "system",
    action: "org.suspend_links",
    targetType: "org",
    targetId: orgId,
    detail: { count: links.length, reason },
  });
  return links.length;
}

/**
 * Find free organizations over the daily redirect ceiling, and new free ones
 * whose traffic looks wrong. Idempotent: an org already flagged, warned or
 * held is skipped, so running this every ten minutes costs a few grouped
 * counts and nothing else.
 */
export async function sweepAbusiveOrgs(env: Env): Promise<void> {
  const db = drizzle(env.DB, { schema });
  // A rolling 24 hours, not the UTC day: a day boundary lets 1,900 redirects
  // at 23:00 and 1,900 more at 00:10 trip nothing.
  const since = Date.now() - DAY_MS;
  await alertOverCeiling(env, db, since);
  await flagSuspiciousOrgs(env, db, since);
}

/** Every org with at least `min` redirects since `since`, and its count. */
function orgsWithRedirects(db: DB, since: number, min: number) {
  return db
    .select({ orgId: schema.clicks.orgId, n: sql<number>`count(*)` })
    .from(schema.clicks)
    .where(gte(schema.clicks.ts, since))
    .groupBy(schema.clicks.orgId)
    .having(sql`count(*) >= ${min}`);
}

/**
 * Alert on every free org over the ceiling, once: a Sentry event and a mail
 * to the platform admin when the org is first flagged or its links first
 * warned, and nothing on the passes after. A new free org's links get the
 * warning page as well. Nothing is suspended (see NEW_ORG_WINDOW_MS).
 */
async function alertOverCeiling(env: Env, db: DB, since: number): Promise<void> {
  const rows = await orgsWithRedirects(db, since, REDIRECT_CEILING_PER_DAY + 1);

  // Independent per org, and the list is short (an org over the ceiling is
  // rare), so handle them together rather than one round trip at a time.
  await Promise.all(
    rows.map(async ({ orgId, n }) => {
      const [{ plan }, { createdAt, cleared }] = await Promise.all([
        orgPlan(db, orgId),
        orgState(db, orgId),
      ]);
      if (plan !== "free" || cleared) return;
      const isNew = createdAt !== null && Date.now() - createdAt <= NEW_ORG_WINDOW_MS;
      const warned = isNew ? await warnOrgLinks(env, db, orgId, WARN_REASON.traffic) : 0;
      const flagged = await flagForReview(db, orgId);
      if (!flagged && warned === 0) return;
      captureAlert([{ event: "org_high_redirect_volume", orgId, redirects: n, warned }]);
      await notifyAdmin(
        env,
        `Over the ceiling: ${n.toLocaleString()} redirects from a free org`,
        [
          `Organization ${orgId} sent ${n.toLocaleString()} redirects in 24 hours, over the free-plan ceiling of ${REDIRECT_CEILING_PER_DAY.toLocaleString()}.`,
          warned > 0
            ? `It is new, so its ${warned} ${warned === 1 ? "link now shows" : "links now show"} a warning before redirecting. Nothing was suspended.`
            : "Its links still redirect. Nothing was suspended.",
        ],
        `/admin/links?org=${encodeURIComponent(orgId)}`,
      );
    }),
  );
}

/** Flag an org for an admin to look at. False when it already was, or its
 * links are suspended, so a caller mails about a flag once. */
export async function flagForReview(db: DB, orgId: string): Promise<boolean> {
  const flagged = await db
    .update(schema.orgs)
    .set({ reviewFlaggedAt: Date.now() })
    .where(
      and(
        eq(schema.orgs.id, orgId),
        isNull(schema.orgs.reviewFlaggedAt),
        isNull(schema.orgs.linksSuspendedAt),
      ),
    )
    .returning({ id: schema.orgs.id });
  return flagged.length > 0;
}

/* ---------------- earlier signals: hold, or flag ---------------- */

/** Redirects in the last hour that look wrong for a new free org. */
const VELOCITY_PER_HOUR = 200;
/** Redirects in 24 hours on a link made in the same 24 hours. A new link that
 * somebody is already pushing hard is the shape of a scam campaign. */
const NEW_LINK_REDIRECTS = 300;
/** An org this new is held, not just flagged. Real launches are rare in the
 * first three days and scams are common, so the cheap mistake is a pause an
 * admin lifts in one click; the expensive one is thousands of victims. */
const HOLD_WINDOW_MS = 3 * DAY_MS;

/**
 * Act on a new free org whose traffic looks wrong: a burst in the last hour,
 * or a link made in the last 24 hours that is already past NEW_LINK_REDIRECTS.
 * Both were true of the 2026-10-18 case, whose links all scored clean: the
 * destination was not the signal, the shape of the traffic was.
 *
 * Under three days old, with a second signal, the org's links are held
 * (suspended, reversible, the owner told why and how to appeal). Otherwise,
 * up to seven days old, it is flagged for an admin and its links show the
 * warning page (#344) but keep working. Idempotent: an org already flagged
 * or suspended is left alone, so this acts once per org.
 */
async function flagSuspiciousOrgs(env: Env, db: DB, since: number): Promise<void> {
  const now = Date.now();
  const [bursts, fresh] = await Promise.all([
    orgsWithRedirects(db, now - HOUR_MS, VELOCITY_PER_HOUR + 1),
    db
      .select({ orgId: schema.clicks.orgId, n: sql<number>`count(*)` })
      .from(schema.clicks)
      .innerJoin(schema.links, eq(schema.links.id, schema.clicks.linkId))
      .where(and(gte(schema.clicks.ts, since), gte(schema.links.createdAt, now - DAY_MS)))
      .groupBy(schema.clicks.orgId, schema.clicks.linkId)
      .having(sql`count(*) >= ${NEW_LINK_REDIRECTS}`),
  ]);

  const seen = new Map<string, { redirects: number; signal: string }>();
  for (const { orgId, n } of bursts) seen.set(orgId, { redirects: n, signal: "burst_last_hour" });
  for (const { orgId, n } of fresh)
    if (!seen.has(orgId)) seen.set(orgId, { redirects: n, signal: "one_new_link" });

  await Promise.all(
    [...seen].map(async ([orgId, { redirects, signal }]) => {
      const [plan, { createdAt, cleared }] = await Promise.all([
        orgPlan(db, orgId),
        orgState(db, orgId),
      ]);
      if (plan.plan !== "free" || cleared) return;
      if (createdAt === null || now - createdAt > NEW_ORG_WINDOW_MS) return;
      // Traffic alone never pauses an org: anyone can drive clicks at somebody
      // else's public link, and a launch looks the same as a campaign. It is
      // held only when something else agrees: a link on a free app host, or an
      // open report. Otherwise its links get the warning page, and it is
      // flagged for a person to look at.
      if (now - createdAt < HOLD_WINDOW_MS && (await hasSecondSignal(db, orgId)))
        return holdOrg(env, db, orgId, redirects, signal);
      const warned = await warnOrgLinks(env, db, orgId, WARN_REASON.traffic);
      if (!(await flagForReview(db, orgId)) && warned === 0) return;
      captureAlert([{ event: "org_needs_review", orgId, redirects, signal }]);
      await notifyAdmin(
        env,
        `Needs review: ${redirects.toLocaleString()} redirects (${signal.replaceAll("_", " ")})`,
        [
          `Organization ${orgId} is a new free org with unusual traffic. Its links still redirect, after a warning page.`,
        ],
        `/admin/orgs`,
      );
    }),
  );
}

/** A free-host destination among the org's links, or an open report on one. */
async function hasSecondSignal(db: DB, orgId: string): Promise<boolean> {
  const [links, reports] = await Promise.all([
    db
      .select({ destination: schema.links.destination })
      .from(schema.links)
      .where(eq(schema.links.orgId, orgId)),
    db
      .select({ id: schema.linkReports.id })
      .from(schema.linkReports)
      .where(and(eq(schema.linkReports.orgId, orgId), eq(schema.linkReports.status, "open")))
      .limit(1),
  ]);
  return reports.length > 0 || links.some((l) => isFreeHost(l.destination));
}

async function holdOrg(env: Env, db: DB, orgId: string, redirects: number, signal: string) {
  const reason = `Held for review: ${redirects} redirects on a brand-new free organization (${signal.replaceAll("_", " ")}).`;
  const held = await suspendOrgLinks(env, db, orgId, null, reason);
  if (held === 0) return;
  captureAlert([{ event: "org_held", orgId, redirects, signal, links: held }]);
  await notifyAdmin(
    env,
    `Held: ${redirects.toLocaleString()} redirects on a new free org`,
    [reason, "Restore it from Organizations if it is legitimate."],
    "/admin/orgs",
  );
  // The owner is told it happened and how to answer it, not which rule fired:
  // a reason that names the threshold is a how-to for the next signup.
  await notifyHold(
    env,
    db,
    orgId,
    "Your links are on hold",
    "Your links got an unusual amount of traffic for a new account, so we paused them until somebody has looked.",
  ).catch(() => {});
}

/**
 * Tell an org's owner that links were paused, and why. The grounds and the way
 * to appeal are in the mail: a pause nobody explains reads as an outage, and
 * an owner who cannot answer it has no way to ask for the pause to be lifted.
 */
/**
 * A short mail to the platform admin, because a Sentry alert is not where a
 * person looks first. One per event, worded as a report about somebody else's
 * org so it is never mistaken for a problem with the admin's own account.
 */
export async function notifyAdmin(
  env: Env,
  subject: string,
  paragraphs: string[],
  path: string,
): Promise<void> {
  const to = env.SUPERADMIN_EMAIL;
  if (!to) return;
  const content = {
    preheader: "Platform admin notice. None of your own links are affected.",
    heading: subject,
    paragraphs,
    cta: { label: "Open it in admin", url: `${env.APP_URL}${path}` },
    footerLine: "Sent to the platform admin.",
  };
  await sendEmail(env, to, subject, renderEmail(content, env.APP_URL, to)).catch(() => {});
}

export async function notifyHold(
  env: Env,
  db: DB,
  orgId: string,
  heading: string,
  grounds: string,
): Promise<void> {
  const owner = await orgOwnerEmail(db, orgId);
  if (!owner) return;
  const content = {
    preheader: "We paused them until somebody has looked.",
    heading,
    paragraphs: [
      grounds,
      "Nothing was deleted. The links do not redirect until we have looked at them, which we do as soon as we can.",
      `If this is a mistake, write to ${SUPPORT_EMAIL} with the name of your organization and what the link is for, and we will restore it. Reports of abuse reach us at ${env.APP_URL}/report.`,
    ],
    cta: { label: "See your links", url: `${env.APP_URL}/links` },
    footerLine: NOTICE_FOOTER,
  };
  await sendEmail(env, owner, heading, renderEmail(content, env.APP_URL, owner)).catch(() => {});
}

/**
 * An org's age, and whether an admin cleared it recently.
 *
 * Without the second, every restore and every "mark reviewed" is undone by
 * the next sweep: it recounts the same 24 hours of redirects, finds the same
 * total, and suspends or flags the org again ten minutes later. Clearing
 * means a human looked, so the automatic checks stand down for a while.
 */
async function orgState(db: DB, orgId: string) {
  const rows = await db
    .select({ createdAt: schema.orgs.createdAt, clearedAt: schema.orgs.clearedAt })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  const row = rows[0];
  return {
    createdAt: row?.createdAt ?? null,
    cleared: row?.clearedAt != null && Date.now() - row.clearedAt < CLEARED_FOR_MS,
  };
}
