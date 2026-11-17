import { Hono } from "hono";
import type { JsonValue, LimitOverrides } from "../../shared/types";
import { effectiveLimits, tierOf } from "../../shared/limits";
import {
  type LimitSetting,
  countLimitHoldersByPlan,
  loadAllLimitSettings,
  loadLimitOverrides,
  saveLimitOverrides,
} from "../limit-overrides";
import {
  optionalFlag,
  optionalText,
  limitsBodySchema,
  parseBody,
  parseOptionalBody,
} from "../schemas";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { eq, ne, gte, and, desc, lt, inArray, isNotNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB } from "../env";
import { requireAdmin } from "../guards";
import { isDisposableEmail } from "../util";
import {
  type AdminUsage,
  type AdminOrgRow,
  type AdminOrgDetail,
  type AdminUserRow,
  type AdminActionRow,
  type OrgPlan,
  orgPlanOf,
} from "@/shared/types";
import { fillSeries, computeDelta, deleteOrg, memberLastActiveAt } from "./orgs";
import { orgPlan } from "../plan";
import { effectivePlanSql, subscriptionGrantsAccess } from "../entitlement";
import { reconcileUser } from "../reconcile";
import { deleteAccountAndOwnedOrgs } from "../better-auth";
import { banUser, ownedDestinationHosts, unbanUser } from "../abuse-hold";
import { jsonBodyLimit } from "../body-limit";
import { adminLinkRoutes } from "./admin-links";
import { adminNewsletterRoutes } from "./admin-newsletter";
import { consentAnswerOf } from "../marketing";
import { recordAdminAction } from "../audit";
import { WEB_RISK_LOOKUPS_PER_DAY, webRiskDay } from "../risk";
import {
  adminAvatarUrl,
  fromLiveOrg,
  liveOrg,
  liveUser,
  linksByCreator,
  orgPlanState,
  orgPlanStateColumns,
  ownerPlan,
  usageForRange,
  usageRange,
} from "../admin-usage";
import { computeWindows } from "../rollups";
import { serveAvatar } from "./avatars";

const ownerName = sql<string | null>`(
  select "user".name from org_members
  join "user" on "user".id = org_members.user_id
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
)`;
const ownerId = sql<string | null>`(
  select user_id from org_members
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
)`;
const ownerEmail = sql<string | null>`(
  select "user".email from org_members
  join "user" on "user".id = org_members.user_id
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
)`;

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", jsonBodyLimit());

adminRoutes.use("*", requireAdmin);

// Mounted after requireAdmin, and that order is the whole security of it: a sub-router
// mounted above this line is reachable by any signed-in user (#67).
adminRoutes.route("/links", adminLinkRoutes);
adminRoutes.route("/newsletter", adminNewsletterRoutes);

const AUDIT_MAX_ROWS = 200;

adminRoutes.get("/audit", async (c) => {
  const log = c.get("log");
  const db = c.var.db;
  const targetType = c.req.query("targetType");
  const targetId = c.req.query("targetId");
  log.set({ auditTargetType: targetType, auditTargetId: targetId });
  const rows = await db
    .select({
      id: schema.adminActions.id,
      actorUserId: schema.adminActions.actorUserId,
      actorEmail: schema.user.email,
      action: schema.adminActions.action,
      targetType: schema.adminActions.targetType,
      targetId: schema.adminActions.targetId,
      detail: schema.adminActions.detail,
      createdAt: schema.adminActions.createdAt,
    })
    .from(schema.adminActions)
    // Left join: the actor may be deleted since, and the entry must outlive them (no foreign key).
    .leftJoin(schema.user, eq(schema.user.id, schema.adminActions.actorUserId))
    .where(
      targetType && targetId
        ? and(
            eq(schema.adminActions.targetType, targetType),
            eq(schema.adminActions.targetId, targetId),
          )
        : undefined,
    )
    .orderBy(desc(schema.adminActions.createdAt))
    .limit(AUDIT_MAX_ROWS);
  return c.json(rows satisfies AdminActionRow[]);
});

const day = sql<string>`date(ts / 1000, 'unixepoch')`;
const userDay = sql<string>`date(created_at / 1000, 'unixepoch')`;
const orgDay = sql<string>`date(created_at / 1000, 'unixepoch')`;

function cumulativeSeries(
  dailyRows: { day: string; clicks: number }[],
  days: number,
): { day: string; clicks: number }[] {
  const cumMap = new Map<string, number>();
  let cum = 0;
  for (const r of dailyRows) {
    cum += r.clicks;
    cumMap.set(r.day, cum);
  }
  const result: { day: string; clicks: number }[] = [];
  const today = new Date();
  let prev = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const val = cumMap.get(key);
    if (val !== undefined) prev = val;
    result.push({ day: key, clicks: prev });
  }
  return result;
}

function computePlanCounts(
  planCountRows: { plan: string; n: number }[],
  limitHolderRows: { plan: string; n: number }[],
) {
  const planCounts = { free: 0, hobby: 0, pro: 0, enterprise: 0 };
  for (const r of planCountRows) planCounts[orgPlanOf(r.plan)] = r.n;
  for (const r of limitHolderRows) {
    const plan = orgPlanOf(r.plan);
    if (plan !== "hobby" && plan !== "pro") continue;
    // The two counts are separate reads, so a ban landing between them can
    // leave fewer in the plan than hold limits; never move more than are there.
    const moved = Math.min(r.n, planCounts[plan]);
    planCounts[plan] -= moved;
    planCounts.enterprise += moved;
  }
  return planCounts;
}

export interface SubscriptionCountRow {
  status: string | null;
}

// A count and nothing else: Polar knows what it charged, so revenue is read there. A subscription
// counts while it entitles anything, including one scheduled to cancel (#82).
export function computeSubscriptionCounts(rows: SubscriptionCountRow[]) {
  return { payingSubscribers: rows.filter((row) => subscriptionGrantsAccess(row.status)).length };
}

/** A count query returns its count as the first row's `n`, or no rows when it is zero. */
export function firstCount(rows: { n: number }[]): number {
  return rows[0]?.n ?? 0;
}

export function computeBusinessMetrics(rows: {
  users: { n: number }[];
  paidPlanUsers: { n: number }[];
  compedUserRows: { n: number }[];
  subscriptionRows: SubscriptionCountRow[];
  planCountRows: { plan: string; n: number }[];
  limitHolderRows: { plan: string; n: number }[];
  signups7dRows: { n: number }[];
  signups7dPrevRows: { n: number }[];
  wauRows: { n: number }[];
}) {
  const totalUsers = firstCount(rows.users);
  // Feature access, comps included: a different question from how many people pay.
  const paidPlanUsers = firstCount(rows.paidPlanUsers);
  const compedUsers = firstCount(rows.compedUserRows);
  const planCounts = computePlanCounts(rows.planCountRows, rows.limitHolderRows);
  const subscriptions = computeSubscriptionCounts(rows.subscriptionRows);
  // Comps come out: a comp grants access but is not a paying customer (#82).
  const payingUsers = Math.max(0, paidPlanUsers - compedUsers);
  const paidConversionRate = totalUsers > 0 ? Math.round((payingUsers / totalUsers) * 100) : null;
  const signups7d = firstCount(rows.signups7dRows);
  const signups7dPrev = firstCount(rows.signups7dPrevRows);
  const signups7dDelta = computeDelta(signups7d, signups7dPrev);
  const wau = firstCount(rows.wauRows);
  return {
    totalUsers,
    payingUsers,
    planCounts,
    compedUsers,
    ...subscriptions,
    paidConversionRate,
    signups7d,
    signups7dDelta,
    wau,
  };
}

async function resolveAnomalyNames(db: DB, candidates: AnomalyCandidate[]) {
  if (!candidates.length) return new Map<string, string>();
  const rows = await db
    .select({ id: schema.orgs.id, name: schema.orgs.name })
    .from(schema.orgs)
    .where(
      inArray(
        schema.orgs.id,
        candidates.map((a) => a.orgId),
      ),
    );
  return new Map(rows.map((r) => [r.id, r.name]));
}

type AnomalyCandidate = { orgId: string; clicks24h: number; avg14d: number; ratio: number };

function findAnomalies(
  recentRows: { orgId: string; clicks: number }[],
  baselineRows: { orgId: string; clicks: number }[],
): AnomalyCandidate[] {
  const baselineMap = new Map(baselineRows.map((r) => [r.orgId, r.clicks]));
  const anomalies: AnomalyCandidate[] = [];
  for (const h of recentRows) {
    const total14d = baselineMap.get(h.orgId) ?? 0;
    const avg14d = total14d / 14;
    if (avg14d >= 1 && h.clicks > 5 * avg14d) {
      anomalies.push({
        orgId: h.orgId,
        clicks24h: h.clicks,
        avg14d: Math.round(avg14d * 10) / 10,
        ratio: Math.round((h.clicks / avg14d) * 10) / 10,
      });
    }
  }
  return anomalies.sort((a, b) => b.ratio - a.ratio);
}

type CapPressureRow = {
  id: string;
  name: string;
  plan: OrgPlan;
  ownerId: string | null;
  linkCount: number;
  memberCount: number;
  domainCount: number;
};

function findCapPressure(orgs: CapPressureRow[], overrides: Map<string, LimitOverrides>) {
  const capPressure: Array<{
    orgId: string;
    orgName: string;
    plan: OrgPlan;
    linksPct: number;
    membersPct: number;
    domainsPct: number;
  }> = [];
  for (const orgRow of orgs) {
    const limits = effectiveLimits(
      orgRow.plan,
      orgRow.ownerId ? overrides.get(orgRow.ownerId) : undefined,
    );
    const linksPct = Math.round((orgRow.linkCount / Math.max(1, limits.links)) * 100);
    const membersPct = Math.round((orgRow.memberCount / Math.max(1, limits.members)) * 100);
    const domainsPct = Math.round((orgRow.domainCount / Math.max(1, limits.domains)) * 100);
    if (linksPct >= 80 || membersPct >= 80 || domainsPct >= 80) {
      capPressure.push({
        orgId: orgRow.id,
        orgName: orgRow.name,
        plan: orgRow.plan,
        linksPct,
        membersPct,
        domainsPct,
      });
    }
  }
  return capPressure.sort(
    (a, b) =>
      Math.max(b.linksPct, b.membersPct, b.domainsPct) -
      Math.max(a.linksPct, a.membersPct, a.domainsPct),
  );
}

// D1 caps at 10 GB; ~100 bytes per click row, so ~107M rows at most.
const MAX_CLICK_ROWS = 107_000_000;

function projectTableGrowth(seriesRows: { day: string; clicks: number }[], tableSize: number) {
  const recentDailyAvg =
    seriesRows.length > 0 ? seriesRows.reduce((s, r) => s + r.clicks, 0) / seriesRows.length : 0;
  const projectedDays =
    recentDailyAvg > 0 ? Math.round((MAX_CLICK_ROWS - tableSize) / recentDailyAvg) : null;
  // Beyond ~10 years the projection isn't a useful signal, and a tiny daily
  // average can project far enough out to overflow JS's Date range.
  return projectedDays !== null && projectedDays <= 3650 ? projectedDays : null;
}

async function webRiskUsage(db: DB) {
  const today = webRiskDay();
  const now = new Date();
  const monthStart = webRiskDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({
      today: sql<number>`coalesce(sum(case when ${schema.webRiskUsage.day} = ${today} then ${schema.webRiskUsage.lookups} end), 0)`,
      month: sql<number>`coalesce(sum(${schema.webRiskUsage.lookups}), 0)`,
    })
    .from(schema.webRiskUsage)
    .where(gte(schema.webRiskUsage.day, monthStart));
  return { today: row?.today ?? 0, month: row?.month ?? 0, perDay: WEB_RISK_LOOKUPS_PER_DAY };
}

adminRoutes.get("/usage", async (c) => {
  const log = c.get("log");
  log.set({ route: "usage" });
  const db = c.var.db;
  const days = usageRange(c.req.query("days"));
  log.set({ usageDays: days });
  const cumDays = 90;
  const since7 = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const since14d = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const since24h = Date.now() - 24 * 60 * 60 * 1000;
  const [
    users,
    orgs,
    links,
    clicks,
    clicks7d,
    paidPlanUsers,
    range,
    planCountRows,
    limitHolderRows,
    signups7dRows,
    signups7dPrevRows,
    wauRows,
    userCreationRows,
    orgCreationRows,
    anomaly24hRows,
    anomaly14dRows,
    compedUserRows,
    subscriptionRows,
  ] = await Promise.all([
    // Banned people and the orgs their ban disabled are left out of every
    // figure below: they are not users, and their links are not usage.
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(liveUser),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.orgs)
      .where(liveOrg),
    // Links and recent clicks of banned orgs are spam, not usage (fromLiveOrg).
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.links)
      .where(fromLiveOrg(schema.links.orgId)),
    // Every row, banned orgs included: this is the table size the storage
    // projection reads, not a usage figure.
    db.select({ n: sql<number>`count(*)` }).from(schema.clicks),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(gte(schema.clicks.ts, since7), fromLiveOrg(schema.clicks.orgId))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(and(ne(schema.user.plan, "free"), liveUser)),
    usageForRange(db, days),
    db
      .select({ plan: schema.user.plan, n: sql<number>`count(*)` })
      .from(schema.user)
      .where(liveUser)
      .groupBy(schema.user.plan),
    countLimitHoldersByPlan(db),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(and(gte(schema.user.createdAt, new Date(since7)), liveUser)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(
        and(
          gte(schema.user.createdAt, new Date(since14d)),
          lt(schema.user.createdAt, new Date(since7)),
          liveUser,
        ),
      ),
    db
      .select({ n: sql<number>`count(distinct user_id)` })
      .from(schema.session)
      .where(
        and(
          gte(schema.session.updatedAt, new Date(since7)),
          sql`${schema.session.userId} not in (select id from "user" where banned = 1)`,
        ),
      ),
    db
      .select({
        day: userDay,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.user)
      .where(liveUser)
      .groupBy(userDay),
    db
      .select({
        day: orgDay,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.orgs)
      .where(liveOrg)
      .groupBy(orgDay),
    db
      .select({
        orgId: schema.clicks.orgId,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since24h))
      .groupBy(schema.clicks.orgId),
    db
      .select({
        orgId: schema.clicks.orgId,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since14d))
      .groupBy(schema.clicks.orgId),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(isNotNull(schema.user.compPlan)),
    db
      .select({ status: schema.user.subscriptionStatus })
      .from(schema.user)
      .where(isNotNull(schema.user.subscriptionPlan)),
  ]);

  const {
    totalUsers,
    payingUsers,
    planCounts,
    compedUsers,
    payingSubscribers,
    paidConversionRate,
    signups7d,
    signups7dDelta,
    wau,
  } = computeBusinessMetrics({
    users,
    paidPlanUsers,
    compedUserRows,
    subscriptionRows,
    planCountRows,
    limitHolderRows,
    signups7dRows,
    signups7dPrevRows,
    wauRows,
  });

  const cumulativeUsers = cumulativeSeries(userCreationRows, cumDays);
  const cumulativeOrgs = cumulativeSeries(orgCreationRows, cumDays);

  const anomalyCandidates = findAnomalies(anomaly24hRows, anomaly14dRows);
  const anomalyNames = await resolveAnomalyNames(db, anomalyCandidates);
  const anomalies = anomalyCandidates.map((a) => ({
    ...a,
    orgName: anomalyNames.get(a.orgId) ?? "Unknown",
  }));

  const allOrgs = await db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      plan: ownerPlan,
      ownerId,
      linkCount: sql<number>`(
        select count(*) from links where links.org_id = orgs.id
      )`,
      memberCount: sql<number>`(
        select count(*) from org_members where org_members.org_id = orgs.id
      )`,
      domainCount: sql<number>`(
        select count(*) from domains where domains.org_id = orgs.id
      )`,
    })
    .from(schema.orgs)
    .where(liveOrg);
  const capPressure = findCapPressure(
    allOrgs,
    await loadLimitOverrides(
      db,
      allOrgs.flatMap((o) => (o.ownerId ? [o.ownerId] : [])),
    ),
  );

  const tableSize = clicks[0]?.n ?? 0;
  const tableProjectedDays = projectTableGrowth(range.series, tableSize);

  return c.json({
    users: totalUsers,
    orgs: orgs[0]?.n ?? 0,
    links: links[0]?.n ?? 0,
    clicks: tableSize,
    clicks7d: clicks7d[0]?.n ?? 0,
    payingUsers,
    ...range,
    planCounts,
    payingSubscribers,
    compedUsers,
    paidConversionRate,
    signups7d,
    signups7dDelta,
    wau,
    cumulativeUsers,
    cumulativeOrgs,
    anomalies,
    capPressure,
    tableSize,
    tableGrowth: range.series,
    tableProjectedDays,
    webRisk: await webRiskUsage(db),
  } satisfies AdminUsage);
});

adminRoutes.get("/orgs", async (c) => {
  const log = c.get("log");
  log.set({ route: "orgs" });
  const db = c.var.db;
  const rows = await db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      plan: ownerPlan,
      createdAt: schema.orgs.createdAt,
      linksSuspendedAt: schema.orgs.linksSuspendedAt,
      reviewFlaggedAt: schema.orgs.reviewFlaggedAt,
      disabledAt: schema.orgs.disabledAt,
      ownerId,
      ownerName,
      ownerEmail,
      // literal orgs.id: interpolated columns render unqualified in correlated subqueries
      members: sql<number>`(
        select count(*) from org_members where org_members.org_id = orgs.id
      )`,
      links: sql<number>`(
        select count(*) from links where links.org_id = orgs.id
      )`,
      // The cause rather than the links swept along with it, whose reasons
      // start "Held with its organization".
      suspendReason: sql<string | null>`(
        select suspend_reason from links
        where links.org_id = orgs.id and links.suspended_at is not null
        order by suspend_reason like 'Held with its organization%', suspended_at
        limit 1
      )`,
      ...orgPlanStateColumns(computeWindows(30).since30),
    })
    .from(schema.orgs)
    .leftJoin(schema.orgEntitlements, eq(schema.orgEntitlements.orgId, schema.orgs.id));
  const now = Date.now();
  return c.json(
    rows.map(({ overJson, entitlementGraceEndsAt, firstDomainLock, ...row }) => ({
      ...row,
      ...orgPlanState({ overJson, entitlementGraceEndsAt, firstDomainLock }, now),
    })) satisfies AdminOrgRow[],
  );
});

adminRoutes.get("/orgs/:orgId", async (c) => {
  const log = c.get("log");
  const db = c.var.db;
  const orgId = c.req.param("orgId");
  log.set({ orgId });
  const orgRows = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  const org = orgRows[0];
  if (!org) throw new HTTPException(404, { message: "Org not found" });
  const { plan } = await orgPlan(db, orgId);

  const days = 30;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const [members, links, seriesRows] = await Promise.all([
    db
      .select({
        userId: schema.orgMembers.userId,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.orgMembers.role,
        createdAt: schema.orgMembers.createdAt,
        demoted: sql<boolean>`${schema.orgMembers.previousRole} is not null`,
        lastActiveAt: memberLastActiveAt,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.user, eq(schema.orgMembers.userId, schema.user.id))
      .where(eq(schema.orgMembers.orgId, orgId)),
    db
      .select({
        id: schema.links.id,
        slug: schema.links.slug,
        domain: schema.domains.hostname,
        destination: schema.links.destination,
        createdAt: schema.links.createdAt,
        // literal links.id: interpolated columns render unqualified in correlated subqueries
        clicks: sql<number>`(
          select count(*) from clicks where clicks.link_id = links.id
        )`,
      })
      .from(schema.links)
      .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
      .where(eq(schema.links.orgId, orgId))
      .orderBy(desc(schema.links.createdAt)),
    db
      .select({ day, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(eq(schema.clicks.orgId, orgId), gte(schema.clicks.ts, since)))
      .groupBy(day),
  ]);

  return c.json({
    id: org.id,
    name: org.name,
    plan,
    createdAt: org.createdAt,
    members,
    links,
    series: fillSeries(seriesRows, days),
  } satisfies AdminOrgDetail);
});

adminRoutes.delete("/orgs/:orgId", async (c) => {
  const log = c.get("log");
  const orgId = c.req.param("orgId");
  log.set({ orgId });
  // Read the name before teardown removes it: the audit entry has to say which org was deleted (#67).
  const rows = await c.var.db
    .select({ name: schema.orgs.name })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  await deleteOrg(c.var.db, c.env, orgId);
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "org.delete",
    targetType: "org",
    targetId: orgId,
    detail: { name: rows[0]?.name ?? null },
  });
  return c.json({ ok: true });
});

adminRoutes.get("/users", async (c) => {
  const log = c.get("log");
  log.set({ route: "users" });
  const db = c.var.db;
  const [rows, links, settings] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        isAdmin: schema.user.isAdmin,
        image: schema.user.image,
        banned: schema.user.banned,
        emailVerified: schema.user.emailVerified,
        plan: schema.user.plan,
        subscriptionPlan: schema.user.subscriptionPlan,
        subscriptionStatus: schema.user.subscriptionStatus,
        cancelAtPeriodEnd: schema.user.polarSubscriptionCancelAtPeriodEnd,
        currentPeriodEnd: schema.user.polarSubscriptionCurrentPeriodEnd,
        compPlan: schema.user.compPlan,
        compReason: schema.user.compReason,
        compGrantedAt: schema.user.compGrantedAt,
        compGrantedBy: sql<string | null>`(
        select grantor.email from "user" as grantor
        where grantor.id = "user".comp_granted_by
      )`,
        createdAt: schema.user.createdAt,
        newsOptInAt: schema.user.newsOptInAt,
        offersOptInAt: schema.user.offersOptInAt,
        marketingAskedAt: schema.user.marketingAskedAt,
        orgCount: sql<number>`(
        select count(*) from org_members where org_members.user_id = "user".id
      )`,
        // literal "user".id: interpolated columns render unqualified in correlated subqueries.
        // last_seen_at outlives the sessions a sign-out deletes (memberLastActiveAt).
        lastSeen: sql<number | null>`(
        select max(t) from (
          select session.updated_at as t from session where session.user_id = "user".id
          union all
          select "user".last_seen_at
        )
      )`,
      })
      .from(schema.user),
    linksByCreator(db),
    loadAllLimitSettings(db),
  ]);
  const emails = new Map(rows.map((r) => [r.id, r.email]));
  return c.json(
    rows.map(({ newsOptInAt, offersOptInAt, marketingAskedAt, ...r }) => ({
      ...r,
      news: consentAnswerOf(newsOptInAt, marketingAskedAt),
      offers: consentAnswerOf(offersOptInAt, marketingAskedAt),
      image: adminAvatarUrl(r.id, r.image),
      links: links.get(r.id) ?? 0,
      ...limitFields(r.plan, settings.get(r.id), emails),
      disposable: isDisposableEmail(r.email),
      createdAt: r.createdAt.getTime(),
      compGrantedAt: r.compGrantedAt?.getTime() ?? null,
      currentPeriodEnd: r.currentPeriodEnd?.getTime() ?? null,
    })) satisfies AdminUserRow[],
  );
});

function limitFields(
  plan: OrgPlan,
  setting: LimitSetting | undefined,
  emails: Map<string, string>,
) {
  const has = setting && Object.keys(setting.overrides).length > 0;
  return {
    tier: tierOf(plan, setting?.overrides),
    limitOverrides: has ? setting.overrides : null,
    limitNote: has ? setting.note : null,
    limitSetBy: has && setting.setBy ? (emails.get(setting.setBy) ?? null) : null,
  };
}

function validateIsAdminPatch(
  value: boolean | null | undefined,
  targetId: string,
  selfId: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === null) throw new HTTPException(400, { message: "isAdmin must be boolean" });
  if (targetId === selfId && !value)
    throw new HTTPException(400, { message: "Cannot demote yourself" });
  return value;
}

async function validateBannedPatch(
  db: DB,
  value: boolean | null | undefined,
  targetId: string,
  selfId: string,
): Promise<boolean | undefined> {
  if (value === undefined) return undefined;
  if (value === null) throw new HTTPException(400, { message: "banned must be boolean" });
  if (targetId === selfId) throw new HTTPException(400, { message: "Cannot ban yourself" });
  if (value) {
    const target = await db
      .select({ isAdmin: schema.user.isAdmin })
      .from(schema.user)
      .where(eq(schema.user.id, targetId));
    if (target[0]?.isAdmin)
      throw new HTTPException(400, { message: "Cannot ban a platform admin" });
  }
  return value;
}

// Granting a plan by hand is not here: it is a comp with its own routes below, because a comp
// written into `plan` was indistinguishable from a paid subscription (#81).
const userPatchSchema = v.object({
  isAdmin: optionalFlag,
  banned: optionalFlag,
  plan: v.optional(v.unknown()),
  reason: optionalText,
  blockHosts: v.optional(v.fallback(v.array(v.string()), []), []),
});

/** /api/user/avatar answers only the signed-in account, so this serves the same object by id. */
adminRoutes.get("/users/:userId/avatar", (c) => serveAvatar(c, c.req.param("userId")));

adminRoutes.get("/users/:userId/hosts", async (c) =>
  c.json(await ownedDestinationHosts(c.var.db, c.req.param("userId"))),
);

adminRoutes.patch("/users/:userId", async (c) => {
  const log = c.get("log");
  const body = parseOptionalBody(userPatchSchema, await c.req.json<JsonValue>().catch(() => ({})));
  const targetId = c.req.param("userId");
  log.set({ userId: targetId });
  const self = c.var.user!;
  const db = c.var.db;

  if (body.plan !== undefined)
    throw new HTTPException(400, {
      message: "Plan is derived from a subscription or a comp: use the comp routes",
    });
  const patch = {
    isAdmin: validateIsAdminPatch(body.isAdmin, targetId, self.id),
    banned: await validateBannedPatch(db, body.banned, targetId, self.id),
  };
  if (patch.isAdmin === undefined && patch.banned === undefined)
    throw new HTTPException(400, { message: "Nothing to update" });
  const banReason = body.reason.trim();
  if (patch.banned === true && !banReason)
    throw new HTTPException(400, { message: "A reason is required" });

  if (patch.isAdmin !== undefined)
    await db
      .update(schema.user)
      .set({ isAdmin: patch.isAdmin })
      .where(eq(schema.user.id, targetId));
  if (patch.banned === true) {
    const reason = banReason;
    const done = await banUser(c.env, db, targetId, self.id, {
      reason,
      blockHosts: body.blockHosts,
    });
    log.set({ ban: done });
    await recordAdminAction(c.env, {
      actorUserId: self.id,
      action: "user.ban",
      targetType: "user",
      targetId,
      detail: { reason, ...done },
    });
    return c.json(done);
  }
  if (patch.banned === false) {
    const orgsRestored = await unbanUser(c.env, db, targetId);
    await recordAdminAction(c.env, {
      actorUserId: self.id,
      action: "user.unban",
      targetType: "user",
      targetId,
      detail: { orgsRestored },
    });
  }
  return c.json({ ok: true });
});

// Never the `subscription_*` columns: a comp must not be able to invent a subscription. The
// reverse holds in billing.ts, where a webhook cannot clear a comp (#81).
async function writeComp(
  db: DB,
  targetId: string,
  comp: { plan: "hobby" | "pro"; reason: string; grantedBy: string } | null,
) {
  const result = await db
    .update(schema.user)
    .set({
      compPlan: comp?.plan ?? null,
      compReason: comp?.reason ?? null,
      compGrantedBy: comp?.grantedBy ?? null,
      compGrantedAt: comp ? new Date() : null,
      plan: effectivePlanSql({ compPlan: comp?.plan ?? null }),
      // The comp's own entry records this change, so reconcileUser finds no Polar change to log.
      auditedPlan: effectivePlanSql({ compPlan: comp?.plan ?? null }),
    })
    .where(eq(schema.user.id, targetId));
  if (result.meta.changes === 0) throw new HTTPException(404, { message: "User not found" });
}

/** Manual too: an admin fixing a stuck org runs this route (#158). */
adminRoutes.post("/users/:userId/reconcile", async (c) => {
  const log = c.get("log");
  log.set({ userId: c.req.param("userId") });
  await reconcileUser(c.env, c.var.db, c.req.param("userId"));
  return c.json({ ok: true });
});

interface CompBody {
  plan?: string;
  reason?: string;
}

adminRoutes.post("/users/:userId/comp", async (c) => {
  const log = c.get("log");
  log.set({ userId: c.req.param("userId") });
  // SAFETY: an unparseable body stands in for an empty one, and every field
  // below is optional, so reading it finds the same absence.
  const body = await c.req.json<CompBody>().catch(() => ({}) as CompBody);
  const plan = body.plan;
  if (plan !== "hobby" && plan !== "pro")
    throw new HTTPException(400, { message: "plan must be hobby or pro" });
  const reason = (body.reason ?? "").trim();
  // A comp with no reason is the state #81 was written about: access nobody can account for.
  if (!reason) throw new HTTPException(400, { message: "reason is required" });
  if (reason.length > 500) throw new HTTPException(400, { message: "reason is too long" });

  await writeComp(c.var.db, c.req.param("userId"), {
    plan,
    reason,
    grantedBy: c.var.user!.id,
  });
  await reconcileUser(c.env, c.var.db, c.req.param("userId"));
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "user.comp_grant",
    targetType: "user",
    targetId: c.req.param("userId")!,
    detail: { plan, reason },
  });
  return c.json({ ok: true });
});

/** The subscription underneath, if any, comes back: `plan` re-derives from the webhook's columns. */
adminRoutes.delete("/users/:userId/comp", async (c) => {
  const log = c.get("log");
  log.set({ userId: c.req.param("userId") });
  await writeComp(c.var.db, c.req.param("userId"), null);
  await reconcileUser(c.env, c.var.db, c.req.param("userId"));
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "user.comp_revoke",
    targetType: "user",
    targetId: c.req.param("userId")!,
  });
  return c.json({ ok: true });
});

// An override only raises, so removing one locks what no longer fits and adding one unlocks it,
// which the reconcile after the write does.
adminRoutes.put("/users/:userId/limits", async (c) => {
  const log = c.get("log");
  const targetId = c.req.param("userId");
  log.set({ userId: targetId });
  const body = parseBody(
    limitsBodySchema,
    await c.req.json<JsonValue>().catch((): JsonValue => null),
  );
  const overrides = body.overrides && Object.keys(body.overrides).length ? body.overrides : null;
  const note = body.note || null;
  if (!(await saveLimitOverrides(c.var.db, targetId, overrides, { note, setBy: c.var.user!.id })))
    throw new HTTPException(404, { message: "User not found" });
  await reconcileUser(c.env, c.var.db, targetId);
  log.audit({
    action: "admin.limits",
    actor: { type: "user", id: c.var.user!.id },
    target: { type: "user", id: targetId },
    outcome: "success",
  });
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "user.limits",
    targetType: "user",
    targetId,
    detail: { overrides, note },
  });
  return c.json({ ok: true });
});

adminRoutes.delete("/users/:userId", async (c) => {
  const log = c.get("log");
  const db = c.var.db;
  const targetId = c.req.param("userId");
  log.set({ userId: targetId });
  if (targetId === c.var.user!.id)
    throw new HTTPException(400, { message: "Cannot delete yourself" });
  // Read the address and the orgs first: the entry has to say who was deleted (#67).
  const target = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, targetId));
  if (!target[0]) throw new HTTPException(404, { message: "User not found" });
  const owned = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.userId, targetId), eq(schema.orgMembers.role, "owner")));
  // Same path as a user deleting their own account: an org has no plan of its own, so one left
  // ownerless has no plan, billing or deleter. Every org the account owns goes, via teardown.
  await deleteAccountAndOwnedOrgs(c.env, targetId);
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "user.delete",
    targetType: "user",
    targetId: targetId,
    detail: { email: target[0].email, orgsDeleted: owned.length },
  });
  return c.json({ ok: true, orgsDeleted: owned.length });
});
