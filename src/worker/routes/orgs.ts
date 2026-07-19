import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireUser, requireOrgRole, orgRole } from "../auth";
import { orgPlan, userPlan } from "../plan";
import { sendEmail } from "../email";
import { uid, now, referrerHost, validateQrFields } from "../util";
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

  const ownedCount = await c.var.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.orgMembers)
    .where(
      and(
        eq(schema.orgMembers.userId, c.var.user!.id),
        eq(schema.orgMembers.role, "owner"),
      ),
    );
  const { limits } = await userPlan(c.var.db, c.var.user!.id);
  if ((ownedCount[0]?.n ?? 0) >= limits.orgs)
    throw new HTTPException(402, {
      message: "Upgrade to Pro to create more organizations",
      cause: { code: "org_limit" },
    });

  const orgId = uid();
  const ts = now();
  await c.var.db.insert(schema.orgs).values({ id: orgId, name, createdAt: ts });
  await c.var.db.insert(schema.orgMembers).values({
    orgId,
    userId: c.var.user!.id,
    role: "owner",
    createdAt: ts,
  });
  return c.json(
    {
      id: orgId,
      name,
      role: "owner",
      plan: "free",
      qrLogo: "",
      qrStyle: "",
      qrColor: "",
    },
    201,
  );
});

orgRoutes.patch("/:orgId", requireOrgRole("owner"), async (c) => {
  const body = await c.req.json<{
    name?: string;
    qrLogo?: string;
    qrStyle?: string;
    qrColor?: string;
  }>();
  const orgId = c.req.param("orgId");

  const set: Partial<typeof schema.orgs.$inferInsert> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new HTTPException(400, { message: "Name required" });
    set.name = name;
  }

  const wantsQr =
    body.qrLogo !== undefined ||
    body.qrStyle !== undefined ||
    body.qrColor !== undefined;
  if (wantsQr) {
    validateQrFields(body);
    // QR customization is a Pro feature, so are the org-level defaults.
    const { limits } = await orgPlan(c.var.db, orgId);
    if (!limits.qr)
      throw new HTTPException(402, {
        message: "QR customization is a Pro feature: upgrade to use it",
      });
    if (body.qrLogo !== undefined) set.qrLogo = body.qrLogo;
    if (body.qrStyle !== undefined) set.qrStyle = body.qrStyle;
    if (body.qrColor !== undefined) set.qrColor = body.qrColor;
  }

  if (Object.keys(set).length === 0)
    throw new HTTPException(400, { message: "Nothing to update" });
  await c.var.db
    .update(schema.orgs)
    .set(set)
    .where(eq(schema.orgs.id, orgId));
  return c.json({ ok: true });
});

/* ---------------- members ---------------- */

orgRoutes.get("/:orgId/members", requireOrgRole("member"), async (c) => {
  const rows = await c.var.db
    .select({
      userId: schema.orgMembers.userId,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.orgMembers.role,
      createdAt: schema.orgMembers.createdAt,
    })
    .from(schema.orgMembers)
    .innerJoin(schema.user, eq(schema.orgMembers.userId, schema.user.id))
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
      {
        id: targetId,
        email: "",
        name: "",
        isAdmin: false,
        emailVerified: false,
        plan: "free",
        polarSubscriptionCancelAtPeriodEnd: false,
        polarSubscriptionCurrentPeriodEnd: null,
      },
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
      {
        id: targetId,
        email: "",
        name: "",
        isAdmin: false,
        emailVerified: false,
        plan: "free",
        polarSubscriptionCancelAtPeriodEnd: false,
        polarSubscriptionCurrentPeriodEnd: null,
      },
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
      email: schema.invites.email,
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

/** Members + open (unaccepted, unexpired) invites, for the plan member cap. */
async function occupiedSeats(
  db: AppEnv["Variables"]["db"],
  orgId: string,
): Promise<number> {
  const ts = now();
  const [members, pending] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, orgId)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.invites)
      .where(
        and(
          eq(schema.invites.orgId, orgId),
          sql`${schema.invites.acceptedBy} is null`,
          gte(schema.invites.expiresAt, ts),
        ),
      ),
  ]);
  return (members[0]?.n ?? 0) + (pending[0]?.n ?? 0);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

orgRoutes.post("/:orgId/invites", requireOrgRole("admin"), async (c) => {
  const body = await c.req.json<{
    role?: "admin" | "member";
    emails?: string[];
  }>();
  const role: "admin" | "member" = body.role === "admin" ? "admin" : "member";
  const orgIdParam = c.req.param("orgId");
  const { plan, limits } = await orgPlan(c.var.db, orgIdParam);

  const emails = [
    ...new Set(
      (body.emails ?? [])
        .map((e) => e.trim().toLowerCase())
        .filter((e) => EMAIL_RE.test(e)),
    ),
  ];
  const need = Math.max(1, emails.length);
  if ((await occupiedSeats(c.var.db, orgIdParam)) + need > limits.members)
    throw new HTTPException(402, {
      message:
        plan === "free"
          ? `The free plan allows ${limits.members} members (including you), upgrade to Pro to invite more`
          : `This plan allows at most ${limits.members} members`,
    });

  const ts = now();

  if (emails.length === 0) {
    const invite = {
      token: uid(24),
      orgId: orgIdParam,
      role,
      email: null,
      createdBy: c.var.user!.id,
      createdAt: ts,
      expiresAt: ts + INVITE_TTL_MS,
      acceptedBy: null,
    } as const;
    await c.var.db.insert(schema.invites).values(invite);
    return c.json(
      {
        invites: [
          {
            token: invite.token,
            role,
            email: invite.email,
            createdAt: invite.createdAt,
            expiresAt: invite.expiresAt,
          } satisfies InviteDTO,
        ],
      },
      201,
    );
  }

  const orgRows = await c.var.db
    .select({ name: schema.orgs.name })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgIdParam));
  const orgName = orgRows[0]?.name ?? "rdyrct";

  const created = emails.map((email) => ({
    token: uid(24),
    orgId: orgIdParam,
    role,
    email,
    createdBy: c.var.user!.id,
    createdAt: ts,
    expiresAt: ts + INVITE_TTL_MS,
    acceptedBy: null as string | null,
  }));

  await c.var.db.insert(schema.invites).values(created);

  await Promise.all(
    created.map((invite) =>
      sendEmail(
        c.env,
        invite.email,
        `You're invited to ${orgName} on rdyrct`,
        `<p>You've been invited to join <strong>${orgName}</strong> on rdyrct.</p>
         <p><a href="${c.env.APP_URL}/invite/${invite.token}">Accept the invite</a>.
         The link expires in 7 days.</p>`,
      ),
    ),
  );

  return c.json(
    {
      invites: created.map(
        (invite) =>
          ({
            token: invite.token,
            role,
            email: invite.email,
            createdAt: invite.createdAt,
            expiresAt: invite.expiresAt,
          }) satisfies InviteDTO,
      ),
    },
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
  // Analytics look-back is a plan feature: Free sees a short window, Pro more.
  const { limits } = await orgPlan(db, orgId);
  const days = limits.analyticsDays;
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
    rangeDays: days,
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

  // Email invites are bound to the address they were sent to; link invites
  // (email null) are bearer links anyone signed in can accept.
  if (invite.email && invite.email !== c.var.user!.email.toLowerCase())
    throw new HTTPException(403, {
      message:
        "This invite was sent to a different email address — sign in with the invited account",
    });

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

  // The cap may have been reached (or the plan downgraded) since the invite
  // was created; recheck against actual members at accept time.
  const { limits } = await orgPlan(db, invite.orgId);
  const members = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.orgId, invite.orgId));
  if ((members[0]?.n ?? 0) >= limits.members)
    throw new HTTPException(402, {
      message: "This organization is full on its current plan",
    });

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
