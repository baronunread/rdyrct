import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { sendEmail } from "./email";
import { NOTICE_FOOTER, renderEmail, SUPPORT_EMAIL } from "./email-layout";
import { orgOwnerEmail, orgPlan } from "./plan";
import { recordAdminAction } from "./audit";
import { captureAlert } from "./sentry";
import { republishOrgLinks } from "./storage";

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
 * A free organization past this many redirects in one UTC day has its links
 * auto-suspended and its owner emailed. Roughly 60x a normal day's whole
 * platform volume, and well under the point where click ingestion strains
 * anything.
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
 * Only an org this new gets auto-suspended by volume alone; an older one is
 * alerted but left for a human to look at.
 *
 * The ceiling counts *recorded* clicks on the public redirect path, which
 * anyone can drive: `RL_CLICK_RECORDING` allows 600/minute per org, so an
 * unauthenticated requester can clear 2,000 in about four minutes just by
 * hammering any org's public link. Acting on raw volume alone would make our
 * own abuse control a way to take down a stranger's org -- point a flood at
 * their link and the sweep suspends the victim. A brand-new org hitting the
 * ceiling is the 2026-09-10 incident's actual shape (an account minting
 * abuse minutes after signup); a long-standing org suddenly seeing volume is
 * at least as likely to be a link that went viral as it is to be abuse, and
 * either way is a case for a human, not an unattended suspension.
 */
const NEW_ORG_WINDOW_MS = 7 * DAY_MS;

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
 * Find free organizations over the daily redirect ceiling and suspend them.
 * Idempotent: an org whose links are already suspended is skipped, so running
 * this every ten minutes costs one grouped count and nothing else.
 */
export async function sweepAbusiveOrgs(env: Env): Promise<void> {
  const db = drizzle(env.DB, { schema });
  const startOfDay = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  await suspendOverCeiling(env, db, startOfDay);
  await flagSuspiciousOrgs(env, db, startOfDay);
}

async function suspendOverCeiling(env: Env, db: DB, startOfDay: number): Promise<void> {
  const rows = await db
    .select({ orgId: schema.clicks.orgId, n: sql<number>`count(*)` })
    .from(schema.clicks)
    .where(gte(schema.clicks.ts, startOfDay))
    .groupBy(schema.clicks.orgId)
    .having(sql`count(*) > ${REDIRECT_CEILING_PER_DAY}`);

  // Independent per org, and the list is short (an org over the ceiling is
  // rare), so handle them together rather than one round trip at a time.
  await Promise.all(
    rows.map(async ({ orgId, n }) => {
      const [{ plan }, createdAt] = await Promise.all([
        orgPlan(db, orgId),
        orgCreatedAt(db, orgId),
      ]);
      if (plan !== "free") return;
      if (createdAt === null || Date.now() - createdAt > NEW_ORG_WINDOW_MS) {
        // Established org: worth a human's attention, not worth suspending
        // unattended (see NEW_ORG_WINDOW_MS above).
        captureAlert([{ event: "org_high_redirect_volume", orgId, redirects: n }]);
        return;
      }
      const reason = `Automatic: ${n} redirects today, over the free-plan ceiling of ${REDIRECT_CEILING_PER_DAY}.`;
      const suspended = await suspendOrgLinks(env, db, orgId, null, reason);
      if (suspended === 0) return;
      captureAlert([{ event: "org_auto_suspended", orgId, redirects: n, links: suspended }]);
      await notifyAutoSuspend(env, db, orgId, n).catch(() => {});
    }),
  );
}

/* ---------------- earlier, softer signals ---------------- */

/** Redirects in the last hour that look wrong for a new free org. A quarter
 * of the daily ceiling, so a spike is seen well before the ceiling is. */
const VELOCITY_PER_HOUR = REDIRECT_CEILING_PER_DAY / 4;
/** Below this many redirects today, "most of them on one link" means little. */
const CONCENTRATION_MIN_CLICKS = REDIRECT_CEILING_PER_DAY / 2;
/** The share of today's redirects on one new link that counts as lopsided. */
const CONCENTRATION_SHARE = 0.9;

/**
 * Flag, without suspending, a new free org whose traffic looks wrong: a burst
 * in the last hour, or nearly all of a day's volume on one link made in the
 * last 24 hours. Both were true of the 2026-10-18 case, whose links all scored
 * clean: the destination was not the signal, the shape of the traffic was.
 *
 * A flag only puts the org at the top of the admin list and fires one alert.
 * The links keep redirecting until a human looks, which is what separates a
 * launch from abuse. Idempotent: an org already flagged or suspended is left
 * alone, so this alerts once per org.
 */
async function flagSuspiciousOrgs(env: Env, db: DB, startOfDay: number): Promise<void> {
  const now = Date.now();
  const bursts = await db
    .select({ orgId: schema.clicks.orgId, n: sql<number>`count(*)` })
    .from(schema.clicks)
    .where(gte(schema.clicks.ts, now - HOUR_MS))
    .groupBy(schema.clicks.orgId)
    .having(sql`count(*) > ${VELOCITY_PER_HOUR}`);

  const busy = await db
    .select({ orgId: schema.clicks.orgId, n: sql<number>`count(*)` })
    .from(schema.clicks)
    .where(gte(schema.clicks.ts, startOfDay))
    .groupBy(schema.clicks.orgId)
    .having(sql`count(*) >= ${CONCENTRATION_MIN_CLICKS}`);

  const lopsided: { orgId: string; n: number }[] = [];
  for (const { orgId, n } of busy) {
    const [top] = await db
      .select({ linkId: schema.clicks.linkId, n: sql<number>`count(*)` })
      .from(schema.clicks)
      .innerJoin(schema.links, eq(schema.links.id, schema.clicks.linkId))
      .where(
        and(
          eq(schema.clicks.orgId, orgId),
          gte(schema.clicks.ts, startOfDay),
          gte(schema.links.createdAt, now - DAY_MS),
        ),
      )
      .groupBy(schema.clicks.linkId)
      .orderBy(sql`count(*) desc`)
      .limit(1);
    if (top && top.n / n >= CONCENTRATION_SHARE) lopsided.push({ orgId, n });
  }

  const seen = new Map<string, { redirects: number; signal: string }>();
  for (const { orgId, n } of bursts) seen.set(orgId, { redirects: n, signal: "burst_last_hour" });
  for (const { orgId, n } of lopsided)
    if (!seen.has(orgId)) seen.set(orgId, { redirects: n, signal: "one_new_link" });

  await Promise.all(
    [...seen].map(async ([orgId, { redirects, signal }]) => {
      const [plan, createdAt] = await Promise.all([orgPlan(db, orgId), orgCreatedAt(db, orgId)]);
      if (plan.plan !== "free") return;
      if (createdAt === null || now - createdAt > NEW_ORG_WINDOW_MS) return;
      const flagged = await db
        .update(schema.orgs)
        .set({ reviewFlaggedAt: now })
        .where(
          and(
            eq(schema.orgs.id, orgId),
            isNull(schema.orgs.reviewFlaggedAt),
            isNull(schema.orgs.linksSuspendedAt),
          ),
        )
        .returning({ id: schema.orgs.id });
      if (flagged.length > 0)
        captureAlert([{ event: "org_needs_review", orgId, redirects, signal }]);
    }),
  );
}

async function orgCreatedAt(db: DB, orgId: string): Promise<number | null> {
  const rows = await db
    .select({ createdAt: schema.orgs.createdAt })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  return rows[0]?.createdAt ?? null;
}

async function notifyAutoSuspend(
  env: Env,
  db: DB,
  orgId: string,
  redirects: number,
): Promise<void> {
  const owner = await orgOwnerEmail(db, orgId);

  const heading = "Your organization is suspended";
  const content = {
    preheader: "Its links stopped redirecting because of unusual traffic.",
    heading,
    paragraphs: [
      `We recorded about ${redirects.toLocaleString()} redirects on your links today, well past what a free organization is expected to send.`,
      "Its links are suspended and no longer redirect. Nothing was deleted.",
      `If this is real traffic, write to ${SUPPORT_EMAIL} or upgrade and we will restore it.`,
    ],
    cta: { label: "See your plan", url: `${env.APP_URL}/billing` },
    footerLine: NOTICE_FOOTER,
  };

  // One failed send must not stop the other, and neither is worth failing the
  // sweep over: the suspension already happened and the alert already fired.
  const send = (addr: string, subject: string, body: typeof content) =>
    sendEmail(env, addr, subject, renderEmail(body, env.APP_URL, addr)).catch(() => {});

  const sends = owner ? [send(owner, heading, content)] : [];

  // The platform admin gets their own mail, worded as a report about somebody
  // else's org: a copy of the owner's "Your organization is suspended" reads
  // as if the admin's own links were stopped. Skipped when the admin owns the
  // org, since the owner mail already reached them.
  const admin = env.SUPERADMIN_EMAIL;
  if (admin && admin !== owner) {
    const adminHeading = `Auto-suspended: ${redirects.toLocaleString()} redirects from a free org`;
    sends.push(
      send(admin, adminHeading, {
        preheader: "Platform admin notice. None of your own links are affected.",
        heading: adminHeading,
        paragraphs: [
          `The abuse sweep suspended the links of organization ${orgId}${owner ? `, owned by ${owner}` : ""}. It recorded about ${redirects.toLocaleString()} redirects today on a new free plan.`,
          "This is a notice for you as platform admin. Your own organizations are not affected.",
          "If the traffic is real, restore its links from the admin Links tab.",
        ],
        cta: { label: "Open the admin Links tab", url: `${env.APP_URL}/admin/links?org=${orgId}` },
        footerLine: "Sent to the platform admin.",
      }),
    );
  }
  await Promise.all(sends);
}
