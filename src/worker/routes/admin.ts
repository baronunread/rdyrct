import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, gte, and, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireAdmin } from "../auth";
import { unpublishLink, unpublishDomain } from "../kv";
import { now } from "../util";
import type {
  AdminOverview,
  AdminOrgRow,
  AdminOrgDetail,
  AdminUserRow,
  OrgPlan,
} from "@/shared/types";
import { fillSeries } from "./orgs";
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

adminRoutes.get("/overview", async (c) => {
  const db = c.var.db;
  const days = 30;
  const since = now() - days * 24 * 60 * 60 * 1000;
  const since7 = now() - 7 * 24 * 60 * 60 * 1000;
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
      .where(eq(schema.user.plan, "pro")),
    db
      .select({ day, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since))
      .groupBy(day),
    db
      .select({
        day: sql<string>`date(created_at / 1000, 'unixepoch')`,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.user)
      .where(gte(schema.user.createdAt, new Date(since)))
      .groupBy(sql`date(created_at / 1000, 'unixepoch')`),
    db
      .select({
        id: schema.orgs.id,
        name: schema.orgs.name,
        clicks: sql<number>`count(*)`,
      })
      .from(schema.clicks)
      .innerJoin(schema.orgs, eq(schema.clicks.orgId, schema.orgs.id))
      .where(gte(schema.clicks.ts, since))
      .groupBy(schema.clicks.orgId)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
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
  ]);

  return c.json({
    users: users[0]?.n ?? 0,
    orgs: orgs[0]?.n ?? 0,
    links: links[0]?.n ?? 0,
    clicks: clicks[0]?.n ?? 0,
    clicks7d: clicks7d[0]?.n ?? 0,
    proUsers: proUsers[0]?.n ?? 0,
    series: fillSeries(seriesRows, days),
    signups: fillSeries(signupRows, days),
    topOrgs: topOrgRows,
    topLinks: topLinkRows,
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
  const db = c.var.db;
  const orgId = c.req.param("orgId");
  const [links, domains] = await Promise.all([
    db
      .select({ slug: schema.links.slug, hostname: schema.domains.hostname })
      .from(schema.links)
      .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
      .where(eq(schema.links.orgId, orgId)),
    db
      .select({ hostname: schema.domains.hostname })
      .from(schema.domains)
      .where(eq(schema.domains.orgId, orgId)),
  ]);
  // clicks/links/members/domains cascade in D1; KV needs manual cleanup
  await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
  await Promise.all([
    ...links.map((l) => unpublishLink(c.env, l.slug, l.hostname)),
    ...domains.map((d) => unpublishDomain(c.env, d.hostname)),
  ]);
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
// plan (Free/Pro). Plan lives on the user, so comping Pro unlocks every org
// they own.
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
    if (body.plan !== "free" && body.plan !== "pro")
      throw new HTTPException(400, { message: "plan must be free or pro" });
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
