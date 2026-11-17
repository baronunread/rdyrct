import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { busiestLinkSince, newLinksWithRedirects, redirectsByOrg } from "./click-overflow";
import { sendEmail } from "./email";
import { NOTICE_FOOTER, renderEmail, SUPPORT_EMAIL } from "./email-layout";
import { isFreeHost } from "../shared/abuse-rules";
import { orgOwnerEmail, orgPlan } from "./plan";
import { recordAdminAction } from "./audit";
import { captureAlert } from "./sentry";
import { republishOrgLinks } from "./storage";
import { WARN_REASON, warnOrgLinks } from "./link-warning";

/**
 * Added after the 2026-09-10 incident (docs/incidents/2026-09-10-queue-ops-exhaustion.md,
 * #224): two links to other shorteners drove ~3,400 redirects and `risk.ts` scored
 * both "Clean" because a redirector resolves fine.
 */

/** Not exhaustive: the cheap early catch. The redirect ceiling below is the backstop. */
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

export function isShortenerDestination(destination: string): boolean {
  let host: string;
  try {
    host = new URL(destination).hostname.toLowerCase();
  } catch {
    return false;
  }
  return SHORTENER_HOSTS.has(host) || [...SHORTENER_HOSTS].some((h) => host.endsWith(`.${h}`));
}

export function assertNotShortener(destination: string): void {
  if (isShortenerDestination(destination))
    throw new HTTPException(422, {
      message: "That destination is another link shortener. Point the link at the final URL.",
      cause: { code: "shortener_destination" },
    });
}

/**
 * Over this many redirects in 24 hours an org is alerted and flagged (#344), never suspended (#387).
 * ponytail: counted from `clicks` on the frequent cron, so it lags and undercounts what the
 * click limiter dropped. Tighten when #50's durable limiter lands.
 */
export const REDIRECT_CEILING_PER_DAY = 2_000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Volume never suspends (#387): the public redirect path can be driven by anyone, so a
 * stranger could take an org down by flooding its link. A brand-new org hitting it matches
 * the 2026-09-10 shape and gets the warning page; an older one is likelier viral, for a human.
 */
export const NEW_ORG_WINDOW_MS = 7 * DAY_MS;

/** Past it the sweep only alerts anyway. */
const CLEARED_FOR_MS = NEW_ORG_WINDOW_MS;

/** Zero means they were already suspended, which makes a repeat call a no-op. */
export async function suspendOrgLinks(
  env: Env,
  db: DB,
  orgId: string,
  // Null when the sweep did it: `links.suspended_by` is a foreign key, so no invented user row.
  suspendedBy: string | null,
  reason: string,
): Promise<number> {
  // Set first and unconditionally: it stops the org minting a replacement link (requireOrgRole reads it).
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
  // After the flag is written; suspension is enforced in storage.ts's desiredKvValue.
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

/** Idempotent: an org already flagged, warned or held is skipped. Returns the spiked links of warned orgs, for Web Risk. */
export async function sweepAbusiveOrgs(env: Env): Promise<{ spikingLinks: string[] }> {
  const db = drizzle(env.DB, { schema });
  // Rolling, not the UTC day: a day boundary lets 1,900 redirects at 23:00 and 1,900 at 00:10 trip nothing.
  const since = Date.now() - DAY_MS;
  await alertOverCeiling(env, db, since);
  return { spikingLinks: await flagSuspiciousOrgs(env, db, since) };
}

function orgsWithRedirects(db: DB, since: number, min: number) {
  return redirectsByOrg(db, since, min);
}

/** Once per org: nothing on later passes. Nothing is suspended (see NEW_ORG_WINDOW_MS). */
async function alertOverCeiling(env: Env, db: DB, since: number): Promise<void> {
  const rows = await orgsWithRedirects(db, since, REDIRECT_CEILING_PER_DAY + 1);

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

/** False when it was already flagged, suspended or banned, so a flag is mailed once. */
export async function flagForReview(db: DB, orgId: string): Promise<boolean> {
  const flagged = await db
    .update(schema.orgs)
    .set({ reviewFlaggedAt: Date.now() })
    .where(
      and(
        eq(schema.orgs.id, orgId),
        isNull(schema.orgs.reviewFlaggedAt),
        isNull(schema.orgs.linksSuspendedAt),
        isNull(schema.orgs.disabledAt),
      ),
    )
    .returning({ id: schema.orgs.id });
  return flagged.length > 0;
}

const VELOCITY_PER_HOUR = 200;
const NEW_LINK_REDIRECTS = 300;
/** Real launches are rare in the first days and scams common: the cheap mistake is a pause an admin lifts in one click. */
const HOLD_WINDOW_MS = 3 * DAY_MS;

/**
 * Both signals were true of the 2026-10-18 case, whose links all scored clean. Under three
 * days old with a second signal the links are held; up to seven days they are flagged and
 * warned. Idempotent. Returns links per signal, since a kit often goes live after the check.
 */
async function flagSuspiciousOrgs(env: Env, db: DB, since: number): Promise<string[]> {
  const now = Date.now();
  const [bursts, fresh] = await Promise.all([
    orgsWithRedirects(db, now - HOUR_MS, VELOCITY_PER_HOUR + 1),
    newLinksWithRedirects(db, since, now - DAY_MS, NEW_LINK_REDIRECTS),
  ]);

  const seen = new Map<string, { redirects: number; signal: string }>();
  for (const { orgId, n } of bursts) seen.set(orgId, { redirects: n, signal: "burst_last_hour" });
  for (const { orgId, n } of fresh)
    if (!seen.has(orgId)) seen.set(orgId, { redirects: n, signal: "one_new_link" });
  const freshLinks = new Map<string, string[]>();
  for (const { orgId, linkId } of fresh)
    freshLinks.set(orgId, [...(freshLinks.get(orgId) ?? []), linkId]);
  const spiking: string[] = [];

  await Promise.all(
    [...seen].map(async ([orgId, { redirects, signal }]) => {
      const [plan, { createdAt, cleared }] = await Promise.all([
        orgPlan(db, orgId),
        orgState(db, orgId),
      ]);
      if (plan.plan !== "free" || cleared) return;
      if (createdAt === null || now - createdAt > NEW_ORG_WINDOW_MS) return;
      // Traffic alone never pauses an org: anyone can drive clicks at a public link.
      // It is held only when something else agrees: a free app host, or an open report.
      if (now - createdAt < HOLD_WINDOW_MS && (await hasSecondSignal(db, orgId)))
        return holdOrg(env, db, orgId, redirects, signal);
      // Before the early return: an org already flagged still spikes.
      const burst = bursts.some((b) => b.orgId === orgId);
      spiking.push(...(await linksBehindSignal(db, orgId, freshLinks, burst, now - HOUR_MS)));
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
  return spiking;
}

async function linksBehindSignal(
  db: DB,
  orgId: string,
  freshLinks: Map<string, string[]>,
  burst: boolean,
  hourAgo: number,
): Promise<string[]> {
  const links = new Set(freshLinks.get(orgId) ?? []);
  const busiest = burst ? await busiestLinkSince(db, orgId, hourAgo) : null;
  if (busiest) links.add(busiest);
  return [...links];
}

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
  // Not told which rule fired: a reason that names the threshold is a how-to for the next signup.
  await notifyHold(
    env,
    db,
    orgId,
    "Your links are on hold",
    "Your links got an unusual amount of traffic for a new account, so we paused them until somebody has looked.",
  ).catch(() => {});
}

/** A pause nobody explains reads as an outage, and the owner needs the way to appeal. */
/** Worded as a report about somebody else's org, never mistaken for the admin's own account. */
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
  more: string[] = [],
): Promise<void> {
  const owner = await orgOwnerEmail(db, orgId);
  if (!owner) return;
  const content = {
    preheader: "We paused them until somebody has looked.",
    heading,
    paragraphs: [
      grounds,
      ...more,
      "Nothing was deleted. The links do not redirect until we have looked at them, which we do as soon as we can.",
      `If this is a mistake, write to ${SUPPORT_EMAIL} with the name of your organization and what the link is for, and we will restore it. Reports of abuse reach us at ${env.APP_URL}/report.`,
    ],
    cta: { label: "See your links", url: `${env.APP_URL}/links` },
    footerLine: NOTICE_FOOTER,
  };
  await sendEmail(env, owner, heading, renderEmail(content, env.APP_URL, owner)).catch(() => {});
}

/**
 * Without the second, every restore and "mark reviewed" is undone by the next
 * sweep, which recounts the same 24 hours. Clearing means a human looked.
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
