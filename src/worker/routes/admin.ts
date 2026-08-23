import { Hono } from "hono";
import type { JsonValue } from "../../shared/types";
import { optionalFlag, parseOptionalBody } from "../schemas";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { eq, ne, gte, and, desc, lt, inArray, isNotNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB } from "../env";
import { requireAdmin } from "../guards";
import { isDisposableEmail } from "../util";
import {
  PLAN_LIMITS,
  type AdminUsage,
  type AdminOrgRow,
  type AdminOrgDetail,
  type AdminUserRow,
  type AdminActionRow,
  type OrgPlan,
  orgPlanOf,
} from "@/shared/types";
import { fillSeries, computeDelta, deleteOrg } from "./orgs";
import { orgPlan } from "../plan";
import { effectivePlanSql, subscriptionGrantsAccess } from "../entitlement";
import { reconcileUser } from "../reconcile";
import { jsonBodyLimit } from "../body-limit";
import { adminLinkRoutes } from "./admin-links";
import { recordAdminAction } from "../audit";

// An org's effective plan is its owner's plan (billing is per-user). A single
// correlated subquery pulls it for list views. Note: `user` is a SQL keyword,
// so it must stay quoted here.
const ownerPlan = sql<OrgPlan>`coalesce((
  select "user".plan from org_members
  join "user" on "user".id = org_members.user_id
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
), 'free')`;

const ownerName = sql<string | null>`(
  select "user".name from org_members
  join "user" on "user".id = org_members.user_id
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
)`;
const ownerEmail = sql<string | null>`(
  select "user".email from org_members
  join "user" on "user".id = org_members.user_id
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
)`;

// Mounted at /api/admin: platform-level views for the instance admin.
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", jsonBodyLimit());

adminRoutes.use("*", requireAdmin);

// Mounted after requireAdmin, and that order is the whole security of it:
// Hono applies middleware registered before a route, so a sub-router mounted
// above this line is reachable by any signed-in user. It was, briefly, and a
// test caught it (#67).
adminRoutes.route("/links", adminLinkRoutes);

const AUDIT_MAX_ROWS = 200;

/**
 * The audit log, newest first, optionally narrowed to one target.
 *
 * Here rather than under /links, where it started: admin_actions covers users
 * and orgs too, and a path that says otherwise is a lie about what it serves
 * (#104).
 */
adminRoutes.get("/audit", async (c) => {
  const db = c.var.db;
  const targetType = c.req.query("targetType");
  const targetId = c.req.query("targetId");
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
    // Left join: the actor may have been deleted since, and the entry has to
    // outlive them. That is why the table holds no foreign key.
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

/* ─────────── helpers ─────────── */

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

function computePlanCounts(planCountRows: { plan: string; n: number }[]) {
  const planCounts = { free: 0, hobby: 0, pro: 0 };
  for (const r of planCountRows) planCounts[orgPlanOf(r.plan)] = r.n;
  return planCounts;
}

export interface SubscriptionCountRow {
  status: string | null;
}

/**
 * How many people actually pay (#82).
 *
 * Deliberately a count and nothing else. `mrr` used to be
 * `hobby * 4 + pro * 9` over the `plan` column, which counted comps as money,
 * read every discount at list price and rewrote history whenever prices
 * changed. Polar already knows what it charged, net of discounts, tax and
 * refunds, so revenue is read there and this reports only what Polar cannot:
 * how the numbers split against our own plans and comps.
 *
 * A subscription is counted while it entitles anything, which includes one
 * scheduled to cancel: the customer has not left yet. Who is leaving shows on
 * their own row in the user list, where it names someone to act on rather
 * than being one more number on a dashboard.
 */
export function computeSubscriptionCounts(rows: SubscriptionCountRow[]) {
  return { payingSubscribers: rows.filter((row) => subscriptionGrantsAccess(row.status)).length };
}

/** Every business-metrics query returns its count as the first row's `n`,
 * or no rows at all when the count is zero. */
export function firstCount(rows: { n: number }[]): number {
  return rows[0]?.n ?? 0;
}

// The "Business" row of /usage: signup/conversion/revenue figures pulled
// out of their raw count-query rows.
export function computeBusinessMetrics(rows: {
  users: { n: number }[];
  proUsers: { n: number }[];
  compedUserRows: { n: number }[];
  subscriptionRows: SubscriptionCountRow[];
  planCountRows: { plan: string; n: number }[];
  signups7dRows: { n: number }[];
  signups7dPrevRows: { n: number }[];
  wauRows: { n: number }[];
}) {
  const totalUsers = firstCount(rows.users);
  // Feature access, comps included: this is "how many people are on a paid
  // plan", which is a different question from "how many people pay".
  const paidUsers = firstCount(rows.proUsers);
  const planCounts = computePlanCounts(rows.planCountRows);
  const subscriptions = computeSubscriptionCounts(rows.subscriptionRows);
  const paidConversionRate = totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) : null;
  const signups7d = firstCount(rows.signups7dRows);
  const signups7dPrev = firstCount(rows.signups7dPrevRows);
  const signups7dDelta = computeDelta(signups7d, signups7dPrev);
  const wau = firstCount(rows.wauRows);
  return {
    totalUsers,
    paidUsers,
    planCounts,
    compedUsers: firstCount(rows.compedUserRows),
    ...subscriptions,
    paidConversionRate,
    signups7d,
    signups7dDelta,
    wau,
  };
}

// Anomaly candidates only carry org ids: resolve their display names in one
// batched lookup, skipping the query entirely when there's nothing to name.
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

// Orgs whose 24h clicks exceed 5x their trailing 14d daily average.
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
  linkCount: number;
  memberCount: number;
  domainCount: number;
};

// Orgs at >=80% of any plan limit.
function findCapPressure(orgs: CapPressureRow[]) {
  const capPressure: Array<{
    orgId: string;
    orgName: string;
    plan: OrgPlan;
    linksPct: number;
    membersPct: number;
    domainsPct: number;
  }> = [];
  for (const orgRow of orgs) {
    const limits = PLAN_LIMITS[orgRow.plan];
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

// D1 caps at 10 GB; ~100 bytes per click row → ~107M max rows.
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

/* ─────────── /usage ─────────── */

adminRoutes.get("/usage", async (c) => {
  const db = c.var.db;
  const days = 30;
  const cumDays = 90;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const since7 = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const since14d = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const since24h = Date.now() - 24 * 60 * 60 * 1000;
  const [
    users,
    orgs,
    links,
    clicks,
    clicks7d,
    proUsers,
    seriesRows,
    signupRows,
    topOrgRows,
    topLinkRows,
    planCountRows,
    signups7dRows,
    signups7dPrevRows,
    wauRows,
    botSeriesRows,
    userCreationRows,
    orgCreationRows,
    anomaly24hRows,
    anomaly14dRows,
    compedUserRows,
    subscriptionRows,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(schema.user),
    db.select({ n: sql<number>`count(*)` }).from(schema.orgs),
    db.select({ n: sql<number>`count(*)` }).from(schema.links),
    db.select({ n: sql<number>`count(*)` }).from(schema.clicks),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since7)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(ne(schema.user.plan, "free")),
    // click series (30d)
    db
      .select({ day, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since))
      .groupBy(day),
    // signup series (30d)
    db
      .select({
        day: userDay,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.user)
      .where(gte(schema.user.createdAt, new Date(since)))
      .groupBy(userDay),
    // top orgs (30d) with plan
    db
      .select({
        id: schema.orgs.id,
        name: schema.orgs.name,
        clicks: sql<number>`count(*)`,
        plan: ownerPlan,
      })
      .from(schema.clicks)
      .innerJoin(schema.orgs, eq(schema.clicks.orgId, schema.orgs.id))
      .where(gte(schema.clicks.ts, since))
      .groupBy(schema.clicks.orgId)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
    // top links (30d)
    db
      .select({
        id: schema.links.id,
        slug: schema.links.slug,
        domain: schema.domains.hostname,
        orgName: schema.orgs.name,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.clicks)
      .innerJoin(schema.links, eq(schema.clicks.linkId, schema.links.id))
      .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
      .innerJoin(schema.orgs, eq(schema.links.orgId, schema.orgs.id))
      .where(gte(schema.clicks.ts, since))
      .groupBy(schema.clicks.linkId)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
    // plan distribution
    db
      .select({ plan: schema.user.plan, n: sql<number>`count(*)` })
      .from(schema.user)
      .groupBy(schema.user.plan),
    // signups 7d (current)
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(gte(schema.user.createdAt, new Date(since7))),
    // signups 7d (previous period)
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(
        and(
          gte(schema.user.createdAt, new Date(since14d)),
          lt(schema.user.createdAt, new Date(since7)),
        ),
      ),
    // weekly active users (distinct sessions in 7d)
    db
      .select({ n: sql<number>`count(distinct user_id)` })
      .from(schema.session)
      .where(gte(schema.session.updatedAt, new Date(since7))),
    // bot clicks per day (30d)
    db
      .select({ day, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(gte(schema.clicks.ts, since), eq(schema.clicks.device, "bot")))
      .groupBy(day),
    // user creation all-time (for cumulative)
    db
      .select({
        day: userDay,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.user)
      .groupBy(userDay),
    // org creation (for weekly)
    db
      .select({
        day: orgDay,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.orgs)
      .groupBy(orgDay),
    // clicks per org in last 24h (anomaly detection)
    db
      .select({
        orgId: schema.clicks.orgId,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since24h))
      .groupBy(schema.clicks.orgId),
    // clicks per org in last 14d (anomaly baseline)
    db
      .select({
        orgId: schema.clicks.orgId,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since14d))
      .groupBy(schema.clicks.orgId),
    // comped users: paid access an admin granted, which is not revenue (#82)
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.user)
      .where(isNotNull(schema.user.compPlan)),
    // live subscriptions: counted, never priced. Money is Polar's figure.
    db
      .select({ status: schema.user.subscriptionStatus })
      .from(schema.user)
      .where(isNotNull(schema.user.subscriptionPlan)),
  ]);

  // ── Business row ──

  const {
    totalUsers,
    paidUsers,
    planCounts,
    compedUsers,
    payingSubscribers,
    paidConversionRate,
    signups7d,
    signups7dDelta,
    wau,
  } = computeBusinessMetrics({
    users,
    proUsers,
    compedUserRows,
    subscriptionRows,
    planCountRows,
    signups7dRows,
    signups7dPrevRows,
    wauRows,
  });

  // ── Growth row ──

  const cumulativeUsers = cumulativeSeries(userCreationRows, cumDays);
  const cumulativeOrgs = cumulativeSeries(orgCreationRows, cumDays);

  // ── Health row ──

  const botSeries = fillSeries(botSeriesRows, days);

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
    .from(schema.orgs);
  const capPressure = findCapPressure(allOrgs);

  // Table size and growth projection
  const tableSize = clicks[0]?.n ?? 0;
  const tableGrowth = fillSeries(seriesRows, days);
  const tableProjectedDays = projectTableGrowth(seriesRows, tableSize);

  return c.json({
    users: totalUsers,
    orgs: orgs[0]?.n ?? 0,
    links: links[0]?.n ?? 0,
    clicks: tableSize,
    clicks7d: clicks7d[0]?.n ?? 0,
    proUsers: paidUsers,
    series: fillSeries(seriesRows, days),
    signups: fillSeries(signupRows, days),
    topOrgs: topOrgRows.map((o) => ({
      ...o,
      plan: orgPlanOf(o.plan),
    })),
    topLinks: topLinkRows,
    planCounts,
    payingSubscribers,
    compedUsers,
    paidConversionRate,
    signups7d,
    signups7dDelta,
    wau,
    cumulativeUsers,
    cumulativeOrgs,
    botSeries,
    anomalies,
    capPressure,
    tableSize,
    tableGrowth,
    tableProjectedDays,
  } satisfies AdminUsage);
});

adminRoutes.get("/orgs", async (c) => {
  const db = c.var.db;
  const rows = await db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      plan: ownerPlan,
      createdAt: schema.orgs.createdAt,
      ownerName,
      ownerEmail,
      // literal orgs.id: interpolated columns render unqualified inside
      // correlated subqueries and bind to the wrong table
      members: sql<number>`(
        select count(*) from org_members where org_members.org_id = orgs.id
      )`,
      links: sql<number>`(
        select count(*) from links where links.org_id = orgs.id
      )`,
      clicks: sql<number>`(
        select count(*) from clicks where clicks.org_id = orgs.id
      )`,
    })
    .from(schema.orgs);
  return c.json(rows satisfies AdminOrgRow[]);
});

adminRoutes.get("/orgs/:orgId", async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId");
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
        // A downgrade demoted this member to viewer (#161), rather than
        // anybody choosing it. Worth seeing from admin too.
        demoted: sql<boolean>`${schema.orgMembers.previousRole} is not null`,
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
        // literal links.id: interpolated columns render unqualified inside
        // correlated subqueries and bind to the wrong table
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
  const orgId = c.req.param("orgId");
  // Read the name before the teardown removes it: an audit entry saying
  // which org was deleted is the entire value of the entry (#67).
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
  const rows = await c.var.db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      isAdmin: schema.user.isAdmin,
      banned: schema.user.banned,
      emailVerified: schema.user.emailVerified,
      plan: schema.user.plan,
      subscriptionPlan: schema.user.subscriptionPlan,
      subscriptionStatus: schema.user.subscriptionStatus,
      cancelAtPeriodEnd: schema.user.polarSubscriptionCancelAtPeriodEnd,
      compPlan: schema.user.compPlan,
      compReason: schema.user.compReason,
      compGrantedAt: schema.user.compGrantedAt,
      // Who granted the comp, by email: an admin reading this list wants a
      // person, not an id. Null once that admin's account is gone.
      compGrantedBy: sql<string | null>`(
        select grantor.email from "user" as grantor
        where grantor.id = "user".comp_granted_by
      )`,
      createdAt: schema.user.createdAt,
      orgCount: sql<number>`(
        select count(*) from org_members where org_members.user_id = "user".id
      )`,
      // literal "user".id: interpolated columns render unqualified inside
      // correlated subqueries and bind to the wrong table
      lastSeen: sql<number | null>`(
        select max(session.updated_at) from session
        where session.user_id = "user".id
      )`,
    })
    .from(schema.user);
  return c.json(
    rows.map((r) => ({
      ...r,
      disposable: isDisposableEmail(r.email),
      createdAt: r.createdAt.getTime(),
      compGrantedAt: r.compGrantedAt?.getTime() ?? null,
    })) satisfies AdminUserRow[],
  );
});

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

// Superadmin controls: toggle platform-admin and ban/unban. Granting a plan
// by hand is not here: it is a comp, and it has its own routes below, because
// a comp written into `plan` was indistinguishable from a paid subscription
// (#81).
/** What the user-patch route reads off its request body. A flag sent as
 * something other than a boolean parses to null, which the validators below
 * refuse by name rather than by silently ignoring. */
const userPatchSchema = v.object({
  isAdmin: optionalFlag,
  banned: optionalFlag,
  plan: v.optional(v.unknown()),
});

adminRoutes.patch("/users/:userId", async (c) => {
  const body = parseOptionalBody(userPatchSchema, await c.req.json<JsonValue>().catch(() => ({})));
  const targetId = c.req.param("userId");
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

  await db.update(schema.user).set(patch).where(eq(schema.user.id, targetId));
  // Banning kicks the user out immediately: all their sessions are wiped, and
  // better-auth refuses to create new ones (see better-auth.ts).
  if (patch.banned) await db.delete(schema.session).where(eq(schema.session.userId, targetId));
  if (patch.banned !== undefined)
    await recordAdminAction(c.env, {
      actorUserId: self.id,
      action: patch.banned ? "user.ban" : "user.unban",
      targetType: "user",
      targetId: targetId,
      detail: { isAdminChanged: patch.isAdmin !== undefined },
    });
  return c.json({ ok: true });
});

/**
 * Writes the `comp_*` columns and re-derives `plan` from them.
 *
 * Never the `subscription_*` columns: a comp says nothing about what Polar
 * knows, so it must not be able to invent a subscription. The reverse holds
 * in routes/billing.ts, where a webhook cannot clear a comp (#81).
 *
 * Granting and revoking are the same statement with opposite values, so they
 * share one, and with it the 404 that means the id matched nobody.
 */
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
    })
    .where(eq(schema.user.id, targetId));
  if (result.meta.changes === 0) throw new HTTPException(404, { message: "User not found" });
}

/** Grant and revoke both change `plan`, so both owe the owner's orgs a pass
 * (#158). Manual too: an admin fixing a stuck org runs this route. */
adminRoutes.post("/users/:userId/reconcile", async (c) => {
  await reconcileUser(c.env, c.var.db, c.req.param("userId"));
  return c.json({ ok: true });
});

/** What the comp route reads off its request body. */
interface CompBody {
  plan?: string;
  reason?: string;
}

/** Grant a comp: paid access an admin gives by hand, recorded as such (#81). */
adminRoutes.post("/users/:userId/comp", async (c) => {
  // SAFETY: an unparseable body stands in for an empty one, and every field
  // below is optional, so reading it finds the same absence.
  const body = await c.req.json<CompBody>().catch(() => ({}) as CompBody);
  const plan = body.plan;
  if (plan !== "hobby" && plan !== "pro")
    throw new HTTPException(400, { message: "plan must be hobby or pro" });
  const reason = (body.reason ?? "").trim();
  // A comp with no reason is the state #81 was written about: access nobody
  // can account for later.
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

/** Revoke a comp. The subscription underneath, if there is one, comes back:
 * `plan` re-derives from the columns the webhook owns. */
adminRoutes.delete("/users/:userId/comp", async (c) => {
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

adminRoutes.delete("/users/:userId", async (c) => {
  const db = c.var.db;
  const targetId = c.req.param("userId");
  if (targetId === c.var.user!.id)
    throw new HTTPException(400, { message: "Cannot delete yourself" });
  const owned = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.userId, targetId), eq(schema.orgMembers.role, "owner")));
  if (owned.length)
    throw new HTTPException(409, {
      message: "User owns organizations, delete those orgs first",
    });
  // Read the address first: the entry has to say who was deleted, and after
  // this statement there is nowhere left to look it up (#67).
  const target = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, targetId));
  // sessions/accounts/org memberships cascade; authored links/invites keep
  // created_by NULL (ON DELETE SET NULL)
  await db.delete(schema.user).where(eq(schema.user.id, targetId));
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "user.delete",
    targetType: "user",
    targetId: targetId,
    detail: { email: target[0]?.email ?? null },
  });
  return c.json({ ok: true });
});
