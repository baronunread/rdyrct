import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, gte, and, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireAdmin } from "../auth";
import { unpublishLink } from "../kv";
import { now } from "../util";
import type { AdminOverview, AdminOrgRow, AdminUserRow } from "@/shared/types";
import { fillSeries } from "./orgs";

// Mounted at /api/admin — platform-level views for the instance admin.
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireAdmin);

const day = sql<string>`date(ts / 1000, 'unixepoch')`;

adminRoutes.get("/overview", async (c) => {
  const db = c.var.db;
  const days = 30;
  const since = now() - days * 24 * 60 * 60 * 1000;
  const since7 = now() - 7 * 24 * 60 * 60 * 1000;
  const [users, orgs, links, clicks, clicks7d, seriesRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(schema.users),
    db.select({ n: sql<number>`count(*)` }).from(schema.orgs),
    db.select({ n: sql<number>`count(*)` }).from(schema.links),
    db.select({ n: sql<number>`count(*)` }).from(schema.clicks),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since7)),
    db
      .select({ day, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(gte(schema.clicks.ts, since))
      .groupBy(day),
  ]);

  return c.json({
    users: users[0]?.n ?? 0,
    orgs: orgs[0]?.n ?? 0,
    links: links[0]?.n ?? 0,
    clicks: clicks[0]?.n ?? 0,
    clicks7d: clicks7d[0]?.n ?? 0,
    series: fillSeries(seriesRows, days),
  } satisfies AdminOverview);
});

adminRoutes.get("/orgs", async (c) => {
  const db = c.var.db;
  const rows = await db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
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

adminRoutes.delete("/orgs/:orgId", async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId");
  const links = await db
    .select({ slug: schema.links.slug })
    .from(schema.links)
    .where(eq(schema.links.orgId, orgId));
  // clicks/links/members cascade in D1; KV entries need manual cleanup
  await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
  await Promise.all(links.map((l) => unpublishLink(c.env, l.slug)));
  return c.json({ ok: true });
});

adminRoutes.get("/users", async (c) => {
  const rows = await c.var.db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      isAdmin: schema.users.isAdmin,
      createdAt: schema.users.createdAt,
      orgCount: sql<number>`(
        select count(*) from org_members where org_members.user_id = users.id
      )`,
    })
    .from(schema.users);
  return c.json(rows satisfies AdminUserRow[]);
});

adminRoutes.patch("/users/:userId", async (c) => {
  const body = await c.req.json<{ isAdmin?: boolean }>();
  if (typeof body.isAdmin !== "boolean")
    throw new HTTPException(400, { message: "isAdmin boolean required" });
  const targetId = c.req.param("userId");
  if (targetId === c.var.user!.id && !body.isAdmin)
    throw new HTTPException(400, { message: "Cannot demote yourself" });
  await c.var.db
    .update(schema.users)
    .set({ isAdmin: body.isAdmin })
    .where(eq(schema.users.id, targetId));
  return c.json({ ok: true });
});
