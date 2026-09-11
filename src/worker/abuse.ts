import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { HTTPException } from "hono/http-exception";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { sendEmail } from "./email";
import { renderEmail } from "./email-layout";
import { orgPlan } from "./plan";
import { recordAdminAction } from "./audit";
import { captureAlert } from "./sentry";
import { enqueueStorage, syncLinkMsg } from "./storage";

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

const REPUBLISH_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function republishOrgLinks(env: Env, db: DB, orgId: string): Promise<void> {
  const addresses = await db
    .select({ slug: schema.linkAddresses.slug, hostname: schema.domains.hostname })
    .from(schema.linkAddresses)
    .innerJoin(schema.links, eq(schema.linkAddresses.linkId, schema.links.id))
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(and(eq(schema.links.orgId, orgId), isNull(schema.linkAddresses.retiredAt)));
  for (let i = 0; i < addresses.length; i += REPUBLISH_BATCH)
    await enqueueStorage(
      env,
      addresses.slice(i, i + REPUBLISH_BATCH).map((a) => syncLinkMsg(a.slug, a.hostname)),
    );
}

/**
 * Find free organizations over the daily redirect ceiling and suspend them.
 * Idempotent: an org whose links are already suspended is skipped, so running
 * this every ten minutes costs one grouped count and nothing else.
 */
export async function sweepAbusiveOrgs(env: Env): Promise<void> {
  const db = drizzle(env.DB, { schema });
  const startOfDay = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const rows = await db
    .select({ orgId: schema.clicks.orgId, n: sql<number>`count(*)` })
    .from(schema.clicks)
    .where(gte(schema.clicks.ts, startOfDay))
    .groupBy(schema.clicks.orgId)
    .having(sql`count(*) > ${REDIRECT_CEILING_PER_DAY}`);

  for (const { orgId, n } of rows) {
    const { plan } = await orgPlan(db, orgId);
    if (plan !== "free") continue;
    const reason = `Automatic: ${n} redirects today, over the free-plan ceiling of ${REDIRECT_CEILING_PER_DAY}.`;
    const suspended = await suspendOrgLinks(env, db, orgId, null, reason);
    if (suspended === 0) continue;
    captureAlert([{ event: "org_auto_suspended", orgId, redirects: n, links: suspended }]);
    await notifyAutoSuspend(env, db, orgId, n).catch(() => {});
  }
}

async function notifyAutoSuspend(
  env: Env,
  db: DB,
  orgId: string,
  redirects: number,
): Promise<void> {
  const rows = await db
    .select({ email: schema.user.email })
    .from(schema.orgMembers)
    .innerJoin(schema.user, eq(schema.orgMembers.userId, schema.user.id))
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, "owner")));

  const heading = "Your organization is suspended";
  const body = renderEmail({
    preheader: "Its links stopped redirecting because of unusual traffic.",
    heading,
    paragraphs: [
      `We recorded about ${redirects.toLocaleString()} redirects on your links today, well past what a free organization is expected to send.`,
      "Its links are suspended and no longer redirect. Nothing was deleted.",
      "If this is real traffic, reply to this email or upgrade and we will restore it.",
    ],
    cta: { label: "See your plan", url: `${env.APP_URL}/billing` },
  });

  const to = [rows[0]?.email, env.SUPERADMIN_EMAIL].filter((addr): addr is string => !!addr);
  // One failed send must not stop the other, and neither is worth failing the
  // sweep over: the suspension already happened and the alert already fired.
  await Promise.all(to.map((addr) => sendEmail(env, addr, heading, body).catch(() => {})));
}
