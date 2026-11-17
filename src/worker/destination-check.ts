/**
 * risk.ts scores; this acts (#341). A free org under seven days old has every link held;
 * an older or paid org has that link alone held and the org flagged. Rechecked weekly for
 * free links, since a kit often goes bad after the link is made.
 */
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createLogger, type AuditableLogger } from "evlog";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import {
  flagForReview,
  sweepAbusiveOrgs,
  NEW_ORG_WINDOW_MS,
  notifyAdmin,
  notifyHold,
  suspendOrgLinks,
} from "./abuse";
import { recordAdminAction } from "./audit";
import { billingEnabled, orgPlan } from "./plan";
import {
  askWebRisk,
  isWebRiskHit,
  scoreAndRecord,
  webRiskThreats,
  webRiskDay,
  webRiskVerdict,
  type RiskVerdict,
  type SpendLookup,
} from "./risk";
import { captureAlert } from "./sentry";
import { republishLink } from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Meant for `waitUntil`: every failure is swallowed, since a link must never fail to
 * save over a lookup. Its own wide event, because the request's was emitted with the
 * response. It carries the link id, never the destination.
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
    if (webRisk === "capped") log.warn("Web Risk's daily cap is spent");
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
 * Every destination edit is a lookup, so flip-flopping at the write rate limit would exceed
 * the free tier and make every lookup fail open. Past this a free org's link is left unstamped
 * for the rescan. 50 because a free org has at most 30 links (PLAN_LIMITS.free.links).
 */
export const WEB_RISK_LOOKUPS_PER_ORG_PER_DAY = 50;

/** One conditional write, so two requests racing cannot both take the last lookup. */
async function spendWebRiskLookup(db: DB, orgId: string): Promise<boolean> {
  if ((await orgPlan(db, orgId)).plan !== "free") return true;
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

/**
 * No org to count against, and without this one caller with fresh URLs could spend the
 * whole site-wide day (WEB_RISK_LOOKUPS_PER_DAY). Past it the link is still made, only
 * not asked about. A cached answer costs nothing, so a known-listed site is still refused.
 */
export const WEB_RISK_ANON_LOOKUPS_PER_CLIENT_PER_DAY = 20;

/** `client` is publicClientKey's HMAC, never the address. One statement, so racing requests cannot both take the last. */
export function spendAnonWebRiskLookup(d1: D1Database, client: string): SpendLookup {
  return async () => {
    const row = await d1
      .prepare(
        `insert into web_risk_anon_usage (client, day, lookups) values (?1, ?2, 1)
         on conflict (client, day) do update set lookups = lookups + 1 where lookups < ?3
         returning lookups`,
      )
      .bind(client, webRiskDay(), WEB_RISK_ANON_LOOKUPS_PER_CLIENT_PER_DAY)
      .first();
    return row !== null;
  };
}

/** No caller's key outlives the day it counted. */
export async function forgetOldAnonWebRiskUsage(d1: D1Database): Promise<void> {
  await d1.prepare("delete from web_risk_anon_usage where day < ?").bind(webRiskDay()).run();
}

const RETRY_AFTER_MS = DAY_MS;

/**
 * Not null, which sorts first: a link that fails every time would take a slot every day
 * ahead of every link never checked. A held link is left alone. Swallows its own failure.
 */
async function retryWebRiskTomorrow(db: DB, linkId: string): Promise<void> {
  await db
    .update(schema.links)
    .set({ webRiskCheckedAt: Date.now() - RESCAN_EVERY_MS + RETRY_AFTER_MS })
    .where(and(eq(schema.links.id, linkId), isNull(schema.links.suspendedAt)))
    .catch(() => {});
}

/**
 * Google's terms ask for it wherever a warning rests on Web Risk (Service Specific Terms
 * §47, "Advisory Notice"). Mail carries it; the held and warning pages never say why.
 */
export const WEB_RISK_NOTICE =
  "Google works to provide the most accurate and up-to-date information about unsafe sites, but cannot guarantee that it is complete and free of errors: some risky sites may not be found, and some safe sites may be listed in error.";
export const WEB_RISK_ADVISORY = `This check uses Google Web Risk. ${WEB_RISK_NOTICE}`;

/** A link already held is left alone, so a repeat hit is a no-op. */
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
  const threats = webRiskThreats(verdict).join(", ");
  const reason = `Google Web Risk lists the destination (${threats}).`;
  const adminPath = `/admin/links?org=${encodeURIComponent(link.orgId)}`;

  // The listed link first, so an org-wide hold does not stamp Google's verdict on clean links.
  const held = await db
    .update(schema.links)
    .set({ suspendedAt: Date.now(), suspendedBy: null, suspendReason: reason })
    .where(and(eq(schema.links.id, linkId), isNull(schema.links.suspendedAt)))
    .returning({ id: schema.links.id });
  if (held.length === 0) return;
  await recordAdminAction(env, {
    actorUserId: "system",
    action: "link.suspend",
    targetType: "link",
    targetId: linkId,
    detail: { orgId: link.orgId, reason },
  });

  if (plan === "free" && Date.now() - link.orgCreatedAt < NEW_ORG_WINDOW_MS) {
    const others = await suspendOrgLinks(
      env,
      db,
      link.orgId,
      null,
      `Held with its organization: another of its links points at a site Google lists (${threats}).`,
    );
    if (others === 0) await republishLink(env, db, linkId);
    const total = others + 1;
    captureAlert([
      { event: "web_risk_hit", orgId: link.orgId, linkId, scope: "org", links: total },
    ]);
    await notifyAdmin(
      env,
      "Held: a new free org links to a site Google lists",
      [
        reason,
        `Organization ${link.orgId} is under seven days old, so all ${total} of its links are held.`,
      ],
      adminPath,
    );
    await notifyHold(
      env,
      db,
      link.orgId,
      "Your links are on hold",
      "One of your links points at a site that Google lists as harmful, so we paused your links until somebody has looked.",
      [WEB_RISK_ADVISORY],
    ).catch(() => {});
    return;
  }

  // After the flag is written; the hold is enforced in storage.ts's desiredLink.
  await republishLink(env, db, linkId);
  await flagForReview(db, link.orgId);
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
    [WEB_RISK_ADVISORY],
  ).catch(() => {});
}

const RESCAN_EVERY_MS = 7 * DAY_MS;

/**
 * Each is one Web Risk lookup and one D1 write, sharing the daily cron's subrequest budget.
 * ponytail: 150 a day covers about a thousand live free links a week. Past that, raise it
 * (the free tier is 100,000 lookups a month) or run it more often.
 */
export const WEB_RISK_RESCAN_BATCH = 150;
const RESCAN_CONCURRENCY = 10;

/** Paid links are checked when made and edited. A paid link Google was never asked about (daily cap spent) comes after every free one. */
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
        or(
          isNull(schema.links.webRiskCheckedAt),
          and(
            eq(schema.user.plan, "free"),
            lt(schema.links.webRiskCheckedAt, Date.now() - RESCAN_EVERY_MS),
          ),
        ),
      ),
    )
    .orderBy(
      sql`${schema.user.plan} != 'free'`,
      sql`${schema.links.webRiskCheckedAt} is not null`,
      asc(schema.links.webRiskCheckedAt),
    )
    .limit(WEB_RISK_RESCAN_BATCH);

  // One wide event per run: a Google outage shows as one `failed` number, not 150 warnings.
  const log = createLogger({ operation: "web_risk.rescan" });
  const counts = { hit: 0, clean: 0, failed: 0, capped: 0, error: 0 } satisfies Record<
    RescanOutcome,
    number
  >;
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
    if (counts.capped > 0) log.warn("Web Risk's daily cap is spent");
    log.emit();
  }
  return counts.hit + counts.clean;
}

/** `failed`: no answer. `capped`: the site's daily cap is spent. `error`: a throw on our side after it answered. */
type RescanOutcome = "hit" | "clean" | "failed" | "capped" | "error";

/** Web Risk alone: the DNS check already runs per click. A clean answer only stamps the date, never overwriting a DNS block with a zero. */
async function rescanOne(
  env: Env,
  db: DB,
  link: { id: string; destination: string },
  log: AuditableLogger,
): Promise<RescanOutcome> {
  try {
    const { verdict, outcome } = await askWebRisk(env, link.destination);
    // Our cap, not Google's failure: leave the stamp so tomorrow's run takes it.
    if (outcome === "capped") return "capped";
    if (!verdict) {
      // Stamped anyway, so a link Google never answers for cannot hold the front of the queue.
      await retryWebRiskTomorrow(db, link.id);
      return "failed";
    }
    return await actOnWebRisk(env, db, link, verdict);
  } catch (error) {
    log.error(error instanceof Error ? error : String(error));
    await retryWebRiskTomorrow(db, link.id);
    return "error";
  }
}

/** A clean answer only stamps the date, never overwriting a DNS block with a zero. */
async function actOnWebRisk(
  env: Env,
  db: DB,
  link: { id: string; destination: string },
  verdict: RiskVerdict,
): Promise<"hit" | "clean"> {
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
    .where(and(eq(schema.links.id, link.id), eq(schema.links.destination, link.destination)))
    .returning({ id: schema.links.id });
  if (hit && written.length > 0) await holdForWebRisk(env, db, link.id, verdict);
  return hit ? "hit" : "clean";
}

/** The sweep runs every ten minutes and shares its subrequests with the outbox drain. */
export const SPIKE_RECHECKS_PER_RUN = 10;
const SPIKE_RECHECK_EVERY_SECONDS = 24 * 60 * 60;
/** Keeps the id list inside D1's 100 bound parameters a statement. */
const SPIKE_CANDIDATES_PER_RUN = 3 * SPIKE_RECHECKS_PER_RUN;
/** Well inside the Worker's 1,000 KV operations an invocation. */
const SPIKE_MARK_READS_PER_RUN = 10 * SPIKE_CANDIDATES_PER_RUN;

type SpikeRechecks = {
  asked: number;
  hit: number;
  failed: number;
  errors: number;
  skipped: number;
};

/**
 * Past the cache and the org's budget: a kit often goes live after its link was checked,
 * and the 2026-10-18 links all scored clean. A KV mark keeps it to one forced lookup per
 * link a day, set only once Google answers, so an outage retries on the next run.
 */
export async function recheckSpikingLinks(env: Env, spiking: string[]): Promise<SpikeRechecks> {
  const counts: SpikeRechecks = { asked: 0, hit: 0, failed: 0, errors: 0, skipped: 0 };
  const key = env.WEB_RISK_API_KEY;
  if (!key) return { ...counts, skipped: spiking.length };
  const db = drizzle(env.DB, { schema });
  const mark = (id: string) => `webrisk:spike:${id}`;
  // Marked links are dropped before the slice, so ones already asked cannot crowd out the rest.
  const linkIds: string[] = [];
  const scan = spiking.slice(0, SPIKE_MARK_READS_PER_RUN);
  for (let i = 0; i < scan.length && linkIds.length < SPIKE_CANDIDATES_PER_RUN;) {
    const chunk = scan.slice(i, (i += SPIKE_CANDIDATES_PER_RUN));
    const marked = await Promise.all(chunk.map((id) => env.LINKS.get(mark(id))));
    linkIds.push(...chunk.filter((_, j) => marked[j] === null));
  }
  linkIds.splice(SPIKE_CANDIDATES_PER_RUN);
  const live =
    linkIds.length === 0
      ? []
      : await db
          .select({ id: schema.links.id, destination: schema.links.destination })
          .from(schema.links)
          .where(and(inArray(schema.links.id, linkIds), isNull(schema.links.suspendedAt)));
  const destinations = new Map(live.map((link) => [link.id, link.destination]));
  const due = linkIds
    .filter((id) => destinations.has(id))
    .slice(0, SPIKE_RECHECKS_PER_RUN)
    .map((id) => ({ id, destination: destinations.get(id) ?? "" }));
  counts.skipped = spiking.length - due.length;

  const outcomes = await Promise.all(
    due.map(async (link) => {
      // Uncached: the cache may hold a clean answer from minutes ago.
      const verdict = await webRiskVerdict(link.destination, key, env.DB);
      if (!verdict) return "failed";
      await env.LINKS.put(mark(link.id), "1", {
        expirationTtl: SPIKE_RECHECK_EVERY_SECONDS,
      }).catch(() => {});
      try {
        return await actOnWebRisk(env, db, link, verdict);
      } catch {
        // The hold threw after the mark and the stamp: drop the mark and put the rescan back to tomorrow.
        await env.LINKS.delete(mark(link.id)).catch(() => {});
        await retryWebRiskTomorrow(db, link.id).catch(() => {});
        return "error";
      }
    }),
  );
  counts.asked = due.length;
  counts.hit = outcomes.filter((o) => o === "hit").length;
  counts.failed = outcomes.filter((o) => o === "failed").length;
  counts.errors = outcomes.filter((o) => o === "error").length;
  return counts;
}

export async function sweepAbuse(env: Env): Promise<void> {
  const log = createLogger({ operation: "abuse.sweep" });
  try {
    const { spikingLinks } = await sweepAbusiveOrgs(env);
    const rechecks = await recheckSpikingLinks(env, spikingLinks);
    log.set({ abuse: { spikingLinks: spikingLinks.length }, webRisk: { spikeRechecks: rechecks } });
    if (rechecks.hit > 0) log.warn("Web Risk lists a link whose traffic spiked");
    if (rechecks.errors > 0) log.warn("A spike recheck could not hold a link Web Risk lists");
  } catch (error) {
    log.error(error instanceof Error ? error : String(error));
    throw error;
  } finally {
    log.emit();
  }
}
