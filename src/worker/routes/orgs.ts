import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireUser, requireOrgRole, orgRole } from "../auth";
import { uid, now, referrerHost } from "../util";
import type {
  MemberDTO,
  InviteDTO,
  OrgStats,
  SeriesPoint,
  InvitePreview,
} from "@/shared/types";

export const orgRoutes = new Hono<AppEnv>();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

orgRoutes.post("/", requireUser, async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) throw new HTTPException(400, { message: "Name required" });
  const orgId = uid();
  const ts = now();
  await c.var.db.insert(schema.orgs).values({ id: orgId, name, createdAt: ts });
  await c.var.db.insert(schema.orgMembers).values({
    orgId,
    userId: c.var.user!.id,
    role: "owner",
    createdAt: ts,
  });
  return c.json({ id: orgId, name, role: "owner" }, 201);
});

orgRoutes.patch("/:orgId", requireOrgRole("owner"), async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) throw new HTTPException(400, { message: "Name required" });
  await c.var.db
    .update(schema.orgs)
    .set({ name })
    .where(eq(schema.orgs.id, c.req.param("orgId")));
  return c.json({ ok: true });
});

/* ---------------- members ---------------- */

orgRoutes.get("/:orgId/members", requireOrgRole("member"), async (c) => {
  const rows = await c.var.db
    .select({
      userId: schema.orgMembers.userId,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.orgMembers.role,
      createdAt: schema.orgMembers.createdAt,
    })
    .from(schema.orgMembers)
    .innerJoin(schema.users, eq(schema.orgMembers.userId, schema.users.id))
    .where(eq(schema.orgMembers.orgId, c.req.param("orgId")));
  return c.json(rows satisfies MemberDTO[]);
});

orgRoutes.patch(
  "/:orgId/members/:userId",
  requireOrgRole("admin"),
  async (c) => {
    const body = await c.req.json<{ role?: "admin" | "member" }>();
    if (body.role !== "admin" && body.role !== "member")
      throw new HTTPException(400, { message: "Role must be admin or member" });
    const orgId = c.req.param("orgId");
    const targetId = c.req.param("userId");
    const target = await orgRole(
      c.var.db,
      { id: targetId, email: "", name: "", isAdmin: false },
      orgId,
    );
    if (!target) throw new HTTPException(404, { message: "Not a member" });
    if (target === "owner")
      throw new HTTPException(400, { message: "Cannot change the owner" });
    await c.var.db
      .update(schema.orgMembers)
      .set({ role: body.role })
      .where(
        and(
          eq(schema.orgMembers.orgId, orgId),
          eq(schema.orgMembers.userId, targetId),
        ),
      );
    return c.json({ ok: true });
  },
);

orgRoutes.delete(
  "/:orgId/members/:userId",
  requireOrgRole("admin"),
  async (c) => {
    const orgId = c.req.param("orgId");
    const targetId = c.req.param("userId");
    const target = await orgRole(
      c.var.db,
      { id: targetId, email: "", name: "", isAdmin: false },
      orgId,
    );
    if (!target) throw new HTTPException(404, { message: "Not a member" });
    if (target === "owner")
      throw new HTTPException(400, { message: "Cannot remove the owner" });
    await c.var.db
      .delete(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.orgId, orgId),
          eq(schema.orgMembers.userId, targetId),
        ),
      );
    return c.json({ ok: true });
  },
);

/* ---------------- invites ---------------- */

orgRoutes.get("/:orgId/invites", requireOrgRole("admin"), async (c) => {
  const rows = await c.var.db
    .select({
      token: schema.invites.token,
      role: schema.invites.role,
      createdAt: schema.invites.createdAt,
      expiresAt: schema.invites.expiresAt,
      acceptedBy: schema.invites.acceptedBy,
    })
    .from(schema.invites)
    .where(eq(schema.invites.orgId, c.req.param("orgId")))
    .orderBy(desc(schema.invites.createdAt));
  const ts = now();
  return c.json(
    rows.filter((r) => !r.acceptedBy && r.expiresAt > ts) satisfies InviteDTO[],
  );
});

orgRoutes.post("/:orgId/invites", requireOrgRole("admin"), async (c) => {
  const body = await c.req.json<{ role?: "admin" | "member" }>();
  const role = body.role === "admin" ? "admin" : "member";
  const invite = {
    token: uid(24),
    orgId: c.req.param("orgId"),
    role,
    createdBy: c.var.user!.id,
    createdAt: now(),
    expiresAt: now() + INVITE_TTL_MS,
    acceptedBy: null,
  } as const;
  await c.var.db.insert(schema.invites).values(invite);
  return c.json(
    {
      token: invite.token,
      role,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    } satisfies InviteDTO,
    201,
  );
});

orgRoutes.delete(
  "/:orgId/invites/:token",
  requireOrgRole("admin"),
  async (c) => {
    await c.var.db
      .delete(schema.invites)
      .where(
        and(
          eq(schema.invites.token, c.req.param("token")),
          eq(schema.invites.orgId, c.req.param("orgId")),
        ),
      );
    return c.json({ ok: true });
  },
);

/* ---------------- stats ---------------- */

function emptySeries(days: number): Map<string, number> {
  const map = new Map<string, number>();
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    map.set(d.toISOString().slice(0, 10), 0);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return map;
}

export function fillSeries(
  rows: { day: string; clicks: number }[],
  days: number,
): SeriesPoint[] {
  const map = emptySeries(days);
  for (const r of rows) if (map.has(r.day)) map.set(r.day, r.clicks);
  return [...map.entries()].map(([day, clicks]) => ({ day, clicks }));
}

const day = sql<string>`date(ts / 1000, 'unixepoch')`;

orgRoutes.get("/:orgId/stats", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId");
  const days = 30;
  const since = now() - days * 24 * 60 * 60 * 1000;
  const since7 = now() - 7 * 24 * 60 * 60 * 1000;
  const inOrg = eq(schema.clicks.orgId, orgId);

  const [totals, recent, seriesRows, topLinks, countries, referrers, devices] =
    await Promise.all([
      db
        .select({
          clicks: sql<number>`count(*)`,
        })
        .from(schema.clicks)
        .where(inOrg),
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.clicks)
        .where(and(inOrg, gte(schema.clicks.ts, since7))),
      db
        .select({ day, clicks: sql<number>`count(*)` })
        .from(schema.clicks)
        .where(and(inOrg, gte(schema.clicks.ts, since)))
        .groupBy(day),
      db
        .select({
          id: schema.links.id,
          slug: schema.links.slug,
          title: schema.links.title,
          clicks: sql<number>`count(${schema.clicks.id})`,
        })
        .from(schema.links)
        .leftJoin(schema.clicks, eq(schema.clicks.linkId, schema.links.id))
        .where(eq(schema.links.orgId, orgId))
        .groupBy(schema.links.id)
        .orderBy(desc(sql`count(${schema.clicks.id})`))
        .limit(8),
      db
        .select({ key: schema.clicks.country, clicks: sql<number>`count(*)` })
        .from(schema.clicks)
        .where(and(inOrg, gte(schema.clicks.ts, since)))
        .groupBy(schema.clicks.country)
        .orderBy(desc(sql`count(*)`))
        .limit(8),
      db
        .select({ key: schema.clicks.referrer, clicks: sql<number>`count(*)` })
        .from(schema.clicks)
        .where(and(inOrg, gte(schema.clicks.ts, since)))
        .groupBy(schema.clicks.referrer)
        .orderBy(desc(sql`count(*)`))
        .limit(8),
      db
        .select({ key: schema.clicks.device, clicks: sql<number>`count(*)` })
        .from(schema.clicks)
        .where(and(inOrg, gte(schema.clicks.ts, since)))
        .groupBy(schema.clicks.device)
        .orderBy(desc(sql`count(*)`)),
    ]);

  const linkCount = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.links)
    .where(eq(schema.links.orgId, orgId));

  const clean = (rows: { key: string; clicks: number }[]) =>
    rows.map((r) => ({ key: r.key || "direct", clicks: r.clicks }));

  return c.json({
    totalClicks: totals[0]?.clicks ?? 0,
    totalLinks: linkCount[0]?.n ?? 0,
    clicks7d: recent[0]?.n ?? 0,
    series: fillSeries(seriesRows, days),
    topLinks,
    countries: clean(countries).map((r) => ({
      ...r,
      key: r.key === "direct" ? "unknown" : r.key,
    })),
    referrers: clean(referrers).map((r) => ({
      ...r,
      key: r.key ? referrerHost(r.key) || r.key : "direct",
    })),
    devices: clean(devices),
  } satisfies OrgStats);
});

/* ---------------- invite acceptance (not org-scoped) ---------------- */

export const inviteRoutes = new Hono<AppEnv>();

inviteRoutes.get("/:token", async (c) => {
  const rows = await c.var.db
    .select({
      role: schema.invites.role,
      expiresAt: schema.invites.expiresAt,
      acceptedBy: schema.invites.acceptedBy,
      orgName: schema.orgs.name,
    })
    .from(schema.invites)
    .innerJoin(schema.orgs, eq(schema.invites.orgId, schema.orgs.id))
    .where(eq(schema.invites.token, c.req.param("token")));
  const invite = rows[0];
  if (!invite || invite.acceptedBy || invite.expiresAt < now())
    throw new HTTPException(404, { message: "Invite not found or expired" });
  return c.json({
    orgName: invite.orgName,
    role: invite.role,
  } satisfies InvitePreview);
});

inviteRoutes.post("/:token/accept", requireUser, async (c) => {
  const db = c.var.db;
  const rows = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.token, c.req.param("token")));
  const invite = rows[0];
  if (!invite || invite.acceptedBy || invite.expiresAt < now())
    throw new HTTPException(404, { message: "Invite not found or expired" });

  const existing = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(
      and(
        eq(schema.orgMembers.orgId, invite.orgId),
        eq(schema.orgMembers.userId, c.var.user!.id),
      ),
    );
  if (existing.length)
    throw new HTTPException(409, { message: "Already a member of this org" });

  await db.insert(schema.orgMembers).values({
    orgId: invite.orgId,
    userId: c.var.user!.id,
    role: invite.role,
    createdAt: now(),
  });
  await db
    .update(schema.invites)
    .set({ acceptedBy: c.var.user!.id })
    .where(eq(schema.invites.token, invite.token));
  return c.json({ orgId: invite.orgId });
});
