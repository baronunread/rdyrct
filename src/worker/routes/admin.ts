import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, ne, gte, and, desc, lt, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireAdmin } from "../auth";
import { now } from "../util";
import { PLAN_LIMITS, type AdminOverview, type AdminOrgRow, type AdminOrgDetail, type AdminUserRow, type OrgPlan } from "@/shared/types";
import { fillSeries, computeDelta, deleteOrgCascade } from "./orgs";
import { orgPlan } from "../plan";

// An org's effective plan is its owner's plan (billing is per-user). A single
// correlated subquery pulls it for list views. Note: `user` is a SQL keyword,
// so it must stay quoted here.
const ownerPlan = sql<OrgPlan>`coalesce((
  select "user".plan from org_members
  join "user" on "user".id = org_members.user_id
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
), 'free')`;

// Mounted at /api/admin: platform-level views for the instance admin.
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireAdmin);

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

/* ─────────── /overview ─────────── */

adminRoutes.get("/overview", async (c) => {
  const db = c.var.db;
  const days = 30;
  const cumDays = 90;
  const since = now() - days * 24 * 60 * 60 * 1000;
  const since7 = now() - 7 * 24 * 60 * 60 * 1000;
  const since14d = now() - 14 * 24 * 60 * 60 * 1000;
  const since24h = now() - 24 * 60 * 60 * 1000;
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
  ]);

  // ── Business row ──

  const totalUsers = users[0]?.n ?? 0;
  const paidUsers = proUsers[0]?.n ?? 0;

  const planCounts = { free: 0, hobby: 0, pro: 0 };
  for (const r of planCountRows) {
    planCounts[r.plan as OrgPlan] = r.n;
  }

  const mrr = planCounts.hobby * 4 + planCounts.pro * 9;

  const paidConversionRate =
    totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) : null;

  const signups7d = signups7dRows[0]?.n ?? 0;
  const signups7dPrev = signups7dPrevRows[0]?.n ?? 0;
  const signups7dDelta = computeDelta(signups7d, signups7dPrev);

  const wau = wauRows[0]?.n ?? 0;

  // ── Growth row ──

  const cumulativeUsers = cumulativeSeries(userCreationRows, cumDays);
  const orgsCreatedPerWeek = cumulativeSeries(orgCreationRows, cumDays);

  // ── Health row ──

  const botSeries = fillSeries(botSeriesRows, days);

  // Anomalies: orgs whose 24h clicks exceed 5x trailing 14d daily avg
  const anomalyMap = new Map(anomaly14dRows.map((r) => [r.orgId, r.clicks]));
  const anomalies: Array<{
    orgId: string;
    orgName: string;
    clicks24h: number;
    avg14d: number;
    ratio: number;
  }> = [];
  for (const h of anomaly24hRows) {
    const total14d = anomalyMap.get(h.orgId) ?? 0;
    const avg14d = total14d / 14;
    if (avg14d >= 1 && h.clicks > 5 * avg14d) {
      anomalies.push({
        orgId: h.orgId,
        orgName: "",
        clicks24h: h.clicks,
        avg14d: Math.round(avg14d * 10) / 10,
        ratio: Math.round((h.clicks / avg14d) * 10) / 10,
      });
    }
  }
  // Fetch names for anomalous orgs
  if (anomalies.length > 0) {
    const ids = anomalies.map((a) => a.orgId);
    const orgRows = await db
      .select({ id: schema.orgs.id, name: schema.orgs.name })
      .from(schema.orgs)
      .where(sql`${schema.orgs.id} in ${ids}`);
    const nameMap = new Map(orgRows.map((r) => [r.id, r.name]));
    for (const a of anomalies) a.orgName = nameMap.get(a.orgId) ?? "Unknown";
  }
  anomalies.sort((a, b) => b.ratio - a.ratio);

  // Cap pressure: orgs at >=80% of any plan limit
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
  const capPressure: Array<{
    orgId: string;
    orgName: string;
    plan: OrgPlan;
    linksPct: number;
    membersPct: number;
    domainsPct: number;
  }> = [];
  for (const orgRow of allOrgs) {
    const limits = PLAN_LIMITS[orgRow.plan];
    const linksPct = Math.round((orgRow.linkCount / Math.max(1, limits.links)) * 100);
    const membersPct = Math.round(
      (orgRow.memberCount / Math.max(1, limits.members)) * 100,
    );
    const domainsPct = Math.round(
      (orgRow.domainCount / Math.max(1, limits.domains)) * 100,
    );
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
  capPressure.sort((a, b) => Math.max(b.linksPct, b.membersPct, b.domainsPct) - Math.max(a.linksPct, a.membersPct, a.domainsPct));

  // Table size and growth projection
  const tableSize = clicks[0]?.n ?? 0;
  const tableGrowth = fillSeries(seriesRows, days);
  // D1 caps at 10 GB; ~100 bytes per click row → ~107M max rows
  const MAX_ROWS = 107_000_000;
  const recentDailyAvg =
    seriesRows.length > 0
      ? seriesRows.reduce((s, r) => s + r.clicks, 0) / seriesRows.length
      : 0;
  const tableProjectedDays =
    recentDailyAvg > 0
      ? Math.round((MAX_ROWS - tableSize) / recentDailyAvg)
      : null;

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
      plan: (o as { plan?: OrgPlan }).plan ?? ("free" as OrgPlan),
    })),
    topLinks: topLinkRows,
    planCounts,
    mrr,
    paidConversionRate,
    signups7d,
    signups7dDelta,
    wau,
    cumulativeUsers,
    orgsCreatedPerWeek,
    botSeries,
    anomalies,
    capPressure,
    tableSize,
    tableGrowth,
    tableProjectedDays,
  } satisfies AdminOverview);
});

adminRoutes.get("/orgs", async (c) => {
  const db = c.var.db;
  const rows = await db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      plan: ownerPlan,
      createdAt: schema.orgs.createdAt,
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
  const orgRows = await db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  const org = orgRows[0];
  if (!org) throw new HTTPException(404, { message: "Org not found" });
  const { plan } = await orgPlan(db, orgId);

  const days = 30;
  const since = now() - days * 24 * 60 * 60 * 1000;

  const [members, links, seriesRows] = await Promise.all([
    db
      .select({
        userId: schema.orgMembers.userId,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.orgMembers.role,
        createdAt: schema.orgMembers.createdAt,
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
  await deleteOrgCascade(c.var.db, c.env, c.req.param("orgId"));
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
      createdAt: r.createdAt.getTime(),
    })) satisfies AdminUserRow[],
  );
});

// Superadmin controls: toggle platform-admin, ban/unban, and/or comp a user's
// plan (free/hobby/pro). Plan lives on the user, so comping a paid plan
// unlocks every org they own.
adminRoutes.patch("/users/:userId", async (c) => {
  const body = await c.req.json<{
    isAdmin?: boolean;
    banned?: boolean;
    plan?: string;
  }>();
  const targetId = c.req.param("userId");
  const self = c.var.user!;
  const patch: { isAdmin?: boolean; banned?: boolean; plan?: OrgPlan } = {};
  if (body.isAdmin !== undefined) {
    if (typeof body.isAdmin !== "boolean")
      throw new HTTPException(400, { message: "isAdmin must be boolean" });
    if (targetId === self.id && !body.isAdmin)
      throw new HTTPException(400, { message: "Cannot demote yourself" });
    patch.isAdmin = body.isAdmin;
  }
  if (body.banned !== undefined) {
    if (typeof body.banned !== "boolean")
      throw new HTTPException(400, { message: "banned must be boolean" });
    if (targetId === self.id)
      throw new HTTPException(400, { message: "Cannot ban yourself" });
    if (body.banned) {
      const target = await c.var.db
        .select({ isAdmin: schema.user.isAdmin })
        .from(schema.user)
        .where(eq(schema.user.id, targetId));
      if (target[0]?.isAdmin)
        throw new HTTPException(400, { message: "Cannot ban a platform admin" });
    }
    patch.banned = body.banned;
  }
  if (body.plan !== undefined) {
    if (body.plan !== "free" && body.plan !== "hobby" && body.plan !== "pro")
      throw new HTTPException(400, {
        message: "plan must be free, hobby or pro",
      });
    patch.plan = body.plan;
  }
  if (
    patch.isAdmin === undefined &&
    patch.banned === undefined &&
    patch.plan === undefined
  )
    throw new HTTPException(400, { message: "Nothing to update" });
  await c.var.db
    .update(schema.user)
    .set(patch)
    .where(eq(schema.user.id, targetId));
  // Banning kicks the user out immediately: all their sessions are wiped, and
  // better-auth refuses to create new ones (see better-auth.ts).
  if (patch.banned)
    await c.var.db
      .delete(schema.session)
      .where(eq(schema.session.userId, targetId));
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
    .where(
      and(
        eq(schema.orgMembers.userId, targetId),
        eq(schema.orgMembers.role, "owner"),
      ),
    );
  if (owned.length)
    throw new HTTPException(409, {
      message: "User owns organizations, delete those orgs first",
    });
  // sessions/accounts/org memberships cascade; authored links/invites keep
  // created_by NULL (ON DELETE SET NULL)
  await db.delete(schema.user).where(eq(schema.user.id, targetId));
  return c.json({ ok: true });
});
