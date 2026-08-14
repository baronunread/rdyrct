import { Hono } from "hono";
import type { JsonValue } from "../../shared/types";
import { HTTPException } from "hono/http-exception";
import { eq, and, gte, desc, sql, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { requireUser } from "../guards";
import { requireOrgRole, orgRole } from "../org-role";
import { orgPlan, userPlan, createOwnedOrg, acceptInviteAtomically } from "../plan";
import { sendEmail } from "../email";
import { renderEmail } from "../email-layout";
import { deleteQrLogoMsg, enqueueStorage } from "../storage";
import { uid, referrerHost, validateQrFields } from "../util";
import { jsonBodyLimit } from "../body-limit";
import { parseBody, inviteBodySchema } from "../schemas";
import type {
  MemberDTO,
  InviteDTO,
  OrgStats,
  LinkStats,
  SeriesPoint,
  InvitePreview,
  RecentClick,
} from "@/shared/types";

export const orgRoutes = new Hono<AppEnv>();
orgRoutes.use("*", jsonBodyLimit());

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

orgRoutes.post("/", requireUser, async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = requireOrgName(body.name ?? "");

  const { limits } = await userPlan(c.var.db, c.var.user!.id);

  const orgId = uid();
  const ts = Date.now();
  // Atomic: the owned-org cap is re-checked at write time inside one D1
  // statement, and an org never persists without an owner (see issue #18).
  const created = await createOwnedOrg(c.var.db, c.env, {
    orgId,
    userId: c.var.user!.id,
    name,
    ts,
    ownedOrgLimit: limits.orgs,
  });
  if (!created)
    throw new HTTPException(402, {
      message: "Upgrade to Pro to create more organizations",
      cause: { code: "org_limit" },
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
      qrCorner: "",
      qrBg: "",
      qrEyeColor: "",
      qrLogoSize: null,
    },
    201,
  );
});

type OrgQrPatchBody = {
  qrLogo?: string;
  qrStyle?: string;
  qrColor?: string;
  qrCorner?: string;
  qrBg?: string;
  qrEyeColor?: string;
  qrLogoSize?: number | null;
};

function wantsQrUpdate(body: OrgQrPatchBody): boolean {
  return (
    body.qrLogo !== undefined ||
    body.qrStyle !== undefined ||
    body.qrColor !== undefined ||
    body.qrCorner !== undefined ||
    body.qrBg !== undefined ||
    body.qrEyeColor !== undefined ||
    body.qrLogoSize !== undefined
  );
}

function qrPatchFields(body: OrgQrPatchBody): Partial<typeof schema.orgs.$inferInsert> {
  const set: Partial<typeof schema.orgs.$inferInsert> = {};
  if (body.qrLogo !== undefined) set.qrLogo = body.qrLogo;
  if (body.qrStyle !== undefined) set.qrStyle = body.qrStyle;
  if (body.qrColor !== undefined) set.qrColor = body.qrColor;
  if (body.qrCorner !== undefined) set.qrCorner = body.qrCorner;
  if (body.qrBg !== undefined) set.qrBg = body.qrBg;
  if (body.qrEyeColor !== undefined) set.qrEyeColor = body.qrEyeColor;
  if (body.qrLogoSize !== undefined) set.qrLogoSize = body.qrLogoSize;
  return set;
}

// Matches the client's own cap (src/app/lib/schemas.ts orgNameSchema): the
// server enforces it too, so a caller that bypasses the client's form
// validation can't store an unbounded name (see issue #19).
const ORG_NAME_MAX_LENGTH = 100;

function requireOrgName(name: JsonValue): string {
  if (typeof name !== "string") throw new HTTPException(400, { message: "Name must be a string" });
  const trimmed = name.trim();
  if (!trimmed) throw new HTTPException(400, { message: "Name required" });
  if (trimmed.length > ORG_NAME_MAX_LENGTH)
    throw new HTTPException(400, {
      message: `Name must be ${ORG_NAME_MAX_LENGTH} characters or fewer`,
    });
  return trimmed;
}

/** Applies the QR fields onto `set` and returns the logo being replaced (""
 * if none), so a cleared/replaced one can be swept from R2. Throws if QR
 * customization isn't on the org's plan. */
async function applyQrPatch(
  db: DB,
  orgId: string,
  body: OrgQrPatchBody,
  set: Partial<typeof schema.orgs.$inferInsert>,
): Promise<string> {
  validateQrFields(body, orgId);
  // QR customization is a paid feature, so are the org-level defaults.
  const { limits } = await orgPlan(db, orgId);
  if (!limits.qrCustom)
    throw new HTTPException(402, {
      message: "QR customization is a paid feature: upgrade to use it",
    });
  Object.assign(set, qrPatchFields(body));
  if (body.qrLogo === undefined) return "";
  const rows = await db
    .select({ qrLogo: schema.orgs.qrLogo })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));
  return rows[0]?.qrLogo ?? "";
}

/**
 * The org's default domain for new links (#69).
 *
 * Only a domain this org owns, and only one that is actually serving: an org
 * cannot point new links at somebody else's hostname, and preselecting a
 * domain still waiting on DNS would hand every new link an address that
 * resolves nowhere. Null clears it, back to the shared domain.
 */
async function resolveDefaultDomain(
  db: DB,
  orgId: string,
  domainId: string | null,
): Promise<string | null> {
  if (domainId === null) return null;
  const rows = await db
    .select({ status: schema.domains.status })
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.orgId, orgId)));
  if (!rows.length) throw new HTTPException(404, { message: "Unknown domain" });
  if (rows[0].status !== "active")
    throw new HTTPException(400, {
      message: "That domain is not serving yet, so it cannot be the default",
    });
  return domainId;
}

orgRoutes.patch("/:orgId", requireOrgRole("admin"), async (c) => {
  const body = await c.req.json<
    { name?: string; defaultDomainId?: string | null } & OrgQrPatchBody
  >();
  const orgId = c.req.param("orgId");
  const db = c.var.db;

  const set: Partial<typeof schema.orgs.$inferInsert> = {};
  if (body.name !== undefined) set.name = requireOrgName(body.name);
  if (body.defaultDomainId !== undefined)
    set.defaultDomainId = await resolveDefaultDomain(db, orgId, body.defaultDomainId);
  const oldLogo = wantsQrUpdate(body) ? await applyQrPatch(db, orgId, body, set) : "";

  if (Object.keys(set).length === 0) throw new HTTPException(400, { message: "Nothing to update" });
  await db.update(schema.orgs).set(set).where(eq(schema.orgs.id, orgId));
  await enqueueStorage(c.env, [
    body.qrLogo !== undefined && body.qrLogo !== oldLogo ? deleteQrLogoMsg(oldLogo) : null,
  ]);
  return c.json({ ok: true });
});

/**
 * Full org teardown, shared with the admin route. Marking the org deleting
 * first closes the gather/d1-delete race: requireOrgRole rejects every
 * org-scoped write from this point on, so nothing can create a link or
 * domain the workflow's gather step never sees. A Cloudflare Workflow then
 * runs the ordered, per-step-retried sequence: capture the org's hostnames
 * and KV keys, delete the org row (D1 cascade), then deprovision Cloudflare
 * hostnames, KV entries, and the R2 logo prefix. Once the instance is
 * created, Workflows runs every step to completion.
 */
const TERMINAL_WORKFLOW_STATUSES = new Set(["errored", "terminated", "complete"]);

/**
 * True if a workflow instance keyed to this org exists and is still doing
 * something. `create()` can fail on the client side (a timeout, say) while
 * still having started the instance server-side, so a create() error alone
 * does not mean nothing is running.
 */
async function orgDeleteWorkflowActive(env: Env, orgId: string): Promise<boolean> {
  try {
    const status = await (await env.ORG_DELETE.get(orgId)).status();
    return !TERMINAL_WORKFLOW_STATUSES.has(status.status);
  } catch {
    return false;
  }
}

export async function deleteOrg(db: DB, env: Env, orgId: string): Promise<void> {
  // Only the request that actually flips the flag tries to start the
  // workflow, so a double-submitted delete is a no-op on the second call
  // instead of racing ORG_DELETE.create against its own keyed instance id.
  const result = await db
    .update(schema.orgs)
    .set({ deletingAt: Date.now() })
    .where(and(eq(schema.orgs.id, orgId), isNull(schema.orgs.deletingAt)));
  if (result.meta.changes === 0) return;
  try {
    await env.ORG_DELETE.create({ id: orgId, params: { orgId } });
  } catch (err) {
    // A failed create() does not prove nothing started: only undo the flag
    // if there is truly no instance driving teardown, so a client-side
    // timeout can never reopen the write window under a workflow that is
    // actually running. If a real instance is running, leave deleting_at set
    // and let it finish; the caller still sees this error and can decide
    // whether to look into it.
    if (!(await orgDeleteWorkflowActive(env, orgId)))
      await db.update(schema.orgs).set({ deletingAt: null }).where(eq(schema.orgs.id, orgId));
    throw err;
  }
}

orgRoutes.delete("/:orgId", requireOrgRole("owner", { allowWhileDeleting: true }), async (c) => {
  await deleteOrg(c.var.db, c.env, c.req.param("orgId"));
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

orgRoutes.patch("/:orgId/members/:userId", requireOrgRole("admin"), async (c) => {
  const body = await c.req.json<{ role?: "admin" | "member" }>();
  if (body.role !== "admin" && body.role !== "member")
    throw new HTTPException(400, { message: "Role must be admin or member" });
  const { orgId, targetId } = await resolveMember(
    c.var.db,
    c.req.param("orgId"),
    c.req.param("userId"),
  );
  await c.var.db
    .update(schema.orgMembers)
    .set({ role: body.role })
    .where(memberWhere(orgId, targetId));
  return c.json({ ok: true });
});

orgRoutes.delete("/:orgId/members/:userId", requireOrgRole("admin"), async (c) => {
  const { orgId, targetId } = await resolveMember(
    c.var.db,
    c.req.param("orgId"),
    c.req.param("userId"),
  );
  await c.var.db.delete(schema.orgMembers).where(memberWhere(orgId, targetId));
  return c.json({ ok: true });
});

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
  const ts = Date.now();
  return c.json(rows.filter((r) => !r.acceptedBy && r.expiresAt > ts) satisfies InviteDTO[]);
});

/** Members + open (unaccepted, unexpired) invites, for the plan member cap. */
async function occupiedSeats(db: AppEnv["Variables"]["db"], orgId: string): Promise<number> {
  const ts = Date.now();
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
  let rawBody: JsonValue;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid request body" });
  }
  const body = parseBody(inviteBodySchema, rawBody);
  const role = body.role;
  const orgIdParam = c.req.param("orgId");
  const { plan, limits } = await orgPlan(c.var.db, orgIdParam);

  const emails = [
    ...new Set(
      body.emails.flatMap((e) => {
        const email = e.trim().toLowerCase();
        return EMAIL_RE.test(email) ? [email] : [];
      }),
    ),
  ];
  const need = Math.max(1, emails.length);
  if ((await occupiedSeats(c.var.db, orgIdParam)) + need > limits.members)
    throw new HTTPException(402, {
      message:
        plan === "free"
          ? `The free plan allows ${limits.members} members (including you), upgrade to a paid plan to invite more`
          : `This plan allows at most ${limits.members} members`,
    });

  const ts = Date.now();

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
        renderEmail({
          preheader: `Join ${orgName} on rdyrct. The invite lasts 7 days.`,
          heading: `You're invited to join ${orgName}`,
          paragraphs: ["rdyrct shortens links and makes QR codes for them."],
          cta: {
            label: "Accept the invite",
            url: `${c.env.APP_URL}/invite/${invite.token}`,
          },
          note: "The invite expires in 7 days.",
        }),
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

orgRoutes.delete("/:orgId/invites/:token", requireOrgRole("admin"), async (c) => {
  await c.var.db
    .delete(schema.invites)
    .where(
      and(
        eq(schema.invites.token, c.req.param("token")),
        eq(schema.invites.orgId, c.req.param("orgId")),
      ),
    );
  return c.json({ ok: true });
});

/* ---------------- stats helpers ---------------- */

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

export function fillSeries(rows: { day: string; clicks: number }[], days: number): SeriesPoint[] {
  const map = emptySeries(days);
  for (const r of rows) if (map.has(r.day)) map.set(r.day, r.clicks);
  return [...map.entries()].map(([day, clicks]) => ({ day, clicks }));
}

const day = sql<string>`date(ts / 1000, 'unixepoch')`;
const hour = sql<string>`strftime('%Y-%m-%d %H:00', ts / 1000, 'unixepoch')`;

function emptyHours(): Map<string, number> {
  const map = new Map<string, number>();
  const hourMs = 60 * 60 * 1000;
  const start = Math.floor((Date.now() - 23 * hourMs) / hourMs) * hourMs;
  for (let i = 0; i < 24; i++) {
    const d = new Date(start + i * hourMs);
    const label = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 13)}:00`;
    map.set(label, 0);
  }
  return map;
}

function fillHours(rows: { hour: string; clicks: number }[]): SeriesPoint[] {
  const map = emptyHours();
  for (const r of rows) if (map.has(r.hour)) map.set(r.hour, r.clicks);
  return [...map.entries()].map(([day, clicks]) => ({ day, clicks }));
}

/** A figure against the figure before it, and the change between them.
 * `pct` is null when there is no earlier figure to compare against. */
export interface Delta {
  current: number;
  previous: number;
  pct: number | null;
}

export function computeDelta(current: number, previous: number): Delta {
  return {
    current,
    previous,
    pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

function cleanDim(rows: { key: string; clicks: number }[]) {
  return rows.map((r) => ({ key: r.key || "direct", clicks: r.clicks }));
}

function clampDays(requested: number | null, planDays: number): number {
  if (!requested || requested < 1) return planDays;
  return Math.min(requested, planDays);
}

function computeWindows(days: number) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return {
    since,
    prevSince: since - days * 24 * 60 * 60 * 1000,
    since7: Date.now() - 7 * 24 * 60 * 60 * 1000,
    prev7Since: Date.now() - 14 * 24 * 60 * 60 * 1000,
    since24: Date.now() - 24 * 60 * 60 * 1000,
  };
}

function clickTotals(
  totals: { clicks: number }[],
  totalsPrev: { clicks: number }[],
  recent: { n: number }[],
  recentPrev: { n: number }[],
) {
  return {
    totalClicks: totals[0]?.clicks ?? 0,
    totalClicksPrev: totalsPrev[0]?.clicks ?? 0,
    clicks7dVal: recent[0]?.n ?? 0,
    clicks7dPrev: recentPrev[0]?.n ?? 0,
  };
}

async function resolveMember(db: DB, orgId: string, targetId: string) {
  await assertMember(db, orgId, targetId);
  return { orgId, targetId };
}

function memberWhere(orgId: string, targetId: string) {
  return and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, targetId));
}

async function assertMember(
  db: DB,
  orgId: string,
  targetId: string,
): Promise<Exclude<Awaited<ReturnType<typeof orgRole>>, null>> {
  const target = await orgRole(
    db,
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
  if (target === "owner") throw new HTTPException(400, { message: "Cannot change the owner" });
  return target;
}

async function lookupInvite(db: DB, token: string) {
  const rows = await db.select().from(schema.invites).where(eq(schema.invites.token, token));
  const invite = rows[0];
  if (!invite || invite.acceptedBy || invite.expiresAt < Date.now())
    throw new HTTPException(404, { message: "Invite not found or expired" });
  return invite;
}

orgRoutes.get("/:orgId/stats", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId");
  const { limits } = await orgPlan(db, orgId);
  const queryDays = c.req.query("days");
  const bucketRaw = c.req.query("bucket");
  const bucket: "day" | "hour" = bucketRaw === "hour" ? "hour" : "day";
  let days = clampDays(queryDays ? parseInt(queryDays, 10) : null, limits.analyticsDays);
  if (bucket === "hour") days = 1;
  const { since, prevSince, since7, prev7Since, since24 } = computeWindows(days);
  const inOrg = eq(schema.clicks.orgId, orgId);

  const [
    totals,
    totalsPrev,
    recent,
    recentPrev,
    seriesRows,
    hourSeriesRows,
    topLinks,
    countries,
    referrers,
    devices,
    linkCount,
    deadLinks,
    decayingRaw,
    heatmapRaw,
    campaignRows,
    sourceRows,
    mediumRows,
  ] = await Promise.all([
    db
      .select({ clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      // Bounded to the selected range (matching totalsPrev's equal-length
      // window below), not an unbounded all-time count: comparing an
      // ever-growing total against one period's worth of prior clicks used
      // to produce a meaningless delta (see issue #24).
      .where(and(inOrg, gte(schema.clicks.ts, since))),
    db
      .select({ clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(inOrg, gte(schema.clicks.ts, prevSince), sql`${schema.clicks.ts} < ${since}`)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(inOrg, gte(schema.clicks.ts, since7))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(inOrg, gte(schema.clicks.ts, prev7Since), sql`${schema.clicks.ts} < ${since7}`)),
    db
      .select({ day, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(inOrg, gte(schema.clicks.ts, since)))
      .groupBy(day),
    db
      .select({ hour, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(inOrg, gte(schema.clicks.ts, since24)))
      .groupBy(hour),
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
      .having(sql`count(${schema.clicks.id}) > 0`)
      .orderBy(desc(sql`count(${schema.clicks.id})`))
      .limit(8),
    db
      .select({ key: schema.clicks.country, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(inOrg, gte(schema.clicks.ts, since)))
      .groupBy(schema.clicks.country)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
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
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.links)
      .where(eq(schema.links.orgId, orgId)),
    db
      .select({ id: schema.links.id, slug: schema.links.slug, title: schema.links.title })
      .from(schema.links)
      .where(
        and(
          eq(schema.links.orgId, orgId),
          // Went cold, not stillborn: had clicks at some point, just none in
          // the last 30 days. A link that never got a single click isn't
          // "dead", it's just new or unshared.
          sql`${schema.links.id} in (select distinct link_id from clicks where org_id = ${orgId})`,
          sql`${schema.links.id} not in (select distinct link_id from clicks where org_id = ${orgId} and ts >= ${Date.now() - 30 * 24 * 60 * 60 * 1000})`,
        ),
      )
      .limit(5),
    // Complex queries that use D1 directly (CTEs, strftime)
    c.env.DB.prepare(
      `with cur as (select link_id, count(*) as n from clicks where org_id = ? and ts >= ? group by link_id),
            prev as (select link_id, count(*) as n from clicks where org_id = ? and ts >= ? and ts < ? group by link_id),
            decay as (select cur.link_id, case when prev.n is null or prev.n = 0 then 100 else round((prev.n - cur.n) * 100.0 / prev.n) end as drop_pct from cur left join prev on cur.link_id = prev.link_id where prev.n is not null and prev.n > 0 and cur.n < prev.n * 0.5)
       select l.id, l.slug, l.title, d.drop_pct from decay d join links l on l.id = d.link_id order by d.drop_pct desc limit 5`,
    )
      .bind(orgId, since7, orgId, prev7Since, since7)
      .all<{ id: string; slug: string; title: string; drop_pct: number }>()
      .then((r) => r.results),
    c.env.DB.prepare(
      `select (cast(strftime('%w', ts / 1000, 'unixepoch') as integer) + 6) % 7 as day_of_week,
              cast(strftime('%H', ts / 1000, 'unixepoch') as integer) as hour,
              count(*) as clicks
       from clicks where org_id = ? and ts >= ?
       group by day_of_week, hour`,
    )
      .bind(orgId, since)
      .all<{ day_of_week: number; hour: number; clicks: number }>()
      .then((r) => r.results),
    db
      .select({
        campaign: schema.links.utmCampaign,
        clicks: sql<number>`count(${schema.clicks.id})`,
      })
      .from(schema.links)
      .innerJoin(schema.clicks, eq(schema.clicks.linkId, schema.links.id))
      .where(
        and(
          eq(schema.links.orgId, orgId),
          gte(schema.clicks.ts, since),
          sql`length(${schema.links.utmCampaign}) > 0`,
        ),
      )
      .groupBy(schema.links.utmCampaign)
      .orderBy(desc(sql`count(${schema.clicks.id})`))
      .limit(8),
    db
      .select({ source: schema.links.utmSource, clicks: sql<number>`count(${schema.clicks.id})` })
      .from(schema.links)
      .innerJoin(schema.clicks, eq(schema.clicks.linkId, schema.links.id))
      .where(
        and(
          eq(schema.links.orgId, orgId),
          gte(schema.clicks.ts, since),
          sql`length(${schema.links.utmSource}) > 0`,
        ),
      )
      .groupBy(schema.links.utmSource)
      .orderBy(desc(sql`count(${schema.clicks.id})`))
      .limit(8),
    db
      .select({ medium: schema.links.utmMedium, clicks: sql<number>`count(${schema.clicks.id})` })
      .from(schema.links)
      .innerJoin(schema.clicks, eq(schema.clicks.linkId, schema.links.id))
      .where(
        and(
          eq(schema.links.orgId, orgId),
          gte(schema.clicks.ts, since),
          sql`length(${schema.links.utmMedium}) > 0`,
        ),
      )
      .groupBy(schema.links.utmMedium)
      .orderBy(desc(sql`count(${schema.clicks.id})`))
      .limit(8),
  ]);

  const { totalClicks, totalClicksPrev, clicks7dVal, clicks7dPrev } = clickTotals(
    totals,
    totalsPrev,
    recent,
    recentPrev,
  );

  return c.json({
    totalClicks,
    totalLinks: linkCount[0]?.n ?? 0,
    clicks7d: clicks7dVal,
    rangeDays: days,
    bucket,
    series: fillSeries(seriesRows, days),
    hourSeries: fillHours(hourSeriesRows),
    totalClicksDelta: computeDelta(totalClicks, totalClicksPrev),
    clicks7dDelta: computeDelta(clicks7dVal, clicks7dPrev),
    topLinks,
    countries: cleanDim(countries).map((r) => ({
      ...r,
      key: r.key === "direct" ? "unknown" : r.key,
    })),
    referrers: cleanDim(referrers).map((r) => ({
      ...r,
      key: r.key ? referrerHost(r.key) || r.key : "direct",
    })),
    devices: cleanDim(devices),
    deadLinks: deadLinks.map((l) => ({ id: l.id, slug: l.slug, title: l.title })),
    decayingLinks: decayingRaw.map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      drop: l.drop_pct,
    })),
    heatmap: heatmapRaw.map((r) => ({ dayOfWeek: r.day_of_week, hour: r.hour, clicks: r.clicks })),
    campaigns: campaignRows.map((r) => ({ campaign: r.campaign, clicks: r.clicks })),
    sources: sourceRows.map((r) => ({ source: r.source, clicks: r.clicks })),
    mediums: mediumRows.map((r) => ({ medium: r.medium, clicks: r.clicks })),
  } satisfies OrgStats);
});

/* ---------------- recent clicks feed (dashboard) ---------------- */

orgRoutes.get("/:orgId/clicks", requireOrgRole("member"), async (c) => {
  const raw = parseInt(c.req.query("limit") ?? "", 10);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 50);
  const rows = await c.var.db
    .select({
      id: schema.clicks.id,
      ts: schema.clicks.ts,
      country: schema.clicks.country,
      referrer: schema.clicks.referrer,
      device: schema.clicks.device,
      slug: schema.links.slug,
      domain: schema.domains.hostname,
    })
    .from(schema.clicks)
    .innerJoin(schema.links, eq(schema.clicks.linkId, schema.links.id))
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.clicks.orgId, c.req.param("orgId")))
    .orderBy(desc(schema.clicks.ts))
    .limit(limit);
  return c.json(
    rows.map((r) => ({
      ...r,
      referrer: r.referrer ? referrerHost(r.referrer) || r.referrer : "",
    })) satisfies RecentClick[],
  );
});

/* ---------------- per-link stats ---------------- */

orgRoutes.get("/:orgId/links/stats/:slug", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId");
  const slug = c.req.param("slug");
  const domain = c.req.query("domain");
  const { limits } = await orgPlan(db, orgId);
  const days = limits.analyticsDays;
  const { since, prevSince, since7, prev7Since } = computeWindows(days);

  // Matched through link_addresses (any active address, not just the link's
  // current primary), so a bookmarked or QR'd URL for an address that has
  // since become a rename alias still lands on the right link (see #38).
  const conditions = [
    eq(schema.linkAddresses.slug, slug),
    eq(schema.linkAddresses.orgId, orgId),
    isNull(schema.linkAddresses.retiredAt),
  ];
  if (domain) conditions.push(eq(schema.domains.hostname, domain));

  const [link] = await db
    .select({
      id: schema.links.id,
      slug: schema.links.slug,
      destination: schema.links.destination,
      title: schema.links.title,
      createdAt: schema.links.createdAt,
      createdBy: schema.links.createdBy,
      domain: schema.domains.hostname,
    })
    .from(schema.linkAddresses)
    .innerJoin(schema.links, eq(schema.linkAddresses.linkId, schema.links.id))
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(and(...conditions))
    .orderBy(sql`case when ${schema.linkAddresses.domainId} is null then 0 else 1 end`)
    .limit(1);

  if (!link) throw new HTTPException(404, { message: "Link not found" });

  const linkId = link.id;
  const onLink = and(eq(schema.clicks.orgId, orgId), eq(schema.clicks.linkId, linkId));

  const [
    totals,
    totalsPrev,
    recent,
    recentPrev,
    seriesRows,
    countries,
    referrers,
    devices,
    lastClickRow,
  ] = await Promise.all([
    db
      .select({ clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      // Bounded to the selected range, same reasoning as the org stats
      // route's totals query above (see issue #24).
      .where(and(onLink, gte(schema.clicks.ts, since))),
    db
      .select({ clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(onLink, gte(schema.clicks.ts, prevSince), sql`${schema.clicks.ts} < ${since}`)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(onLink, gte(schema.clicks.ts, since7))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(onLink, gte(schema.clicks.ts, prev7Since), sql`${schema.clicks.ts} < ${since7}`)),
    db
      .select({ day, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(onLink, gte(schema.clicks.ts, since)))
      .groupBy(day),
    db
      .select({ key: schema.clicks.country, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(onLink, gte(schema.clicks.ts, since)))
      .groupBy(schema.clicks.country)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db
      .select({ key: schema.clicks.referrer, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(onLink, gte(schema.clicks.ts, since)))
      .groupBy(schema.clicks.referrer)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
    db
      .select({ key: schema.clicks.device, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(and(onLink, gte(schema.clicks.ts, since)))
      .groupBy(schema.clicks.device)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ ts: schema.clicks.ts })
      .from(schema.clicks)
      .where(onLink)
      .orderBy(desc(schema.clicks.ts))
      .limit(1),
  ]);

  const { totalClicks, totalClicksPrev, clicks7dVal, clicks7dPrev } = clickTotals(
    totals,
    totalsPrev,
    recent,
    recentPrev,
  );

  return c.json({
    id: link.id,
    totalClicks,
    clicks7d: clicks7dVal,
    rangeDays: days,
    series: fillSeries(seriesRows, days),
    totalClicksDelta: computeDelta(totalClicks, totalClicksPrev),
    clicks7dDelta: computeDelta(clicks7dVal, clicks7dPrev),
    countries: cleanDim(countries).map((r) => ({
      ...r,
      key: r.key === "direct" ? "unknown" : r.key,
    })),
    referrers: cleanDim(referrers).map((r) => ({
      ...r,
      key: r.key ? referrerHost(r.key) || r.key : "direct",
    })),
    devices: cleanDim(devices),
    slug: link.slug,
    domain: link.domain,
    destination: link.destination,
    title: link.title,
    createdAt: link.createdAt,
    lastClick: lastClickRow[0]?.ts ?? null,
    createdBy: link.createdBy,
  } satisfies LinkStats);
});

/* ---------------- invite acceptance (not org-scoped) ---------------- */

export const inviteRoutes = new Hono<AppEnv>();
inviteRoutes.use("*", jsonBodyLimit());

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
  if (!invite || invite.acceptedBy || invite.expiresAt < Date.now())
    throw new HTTPException(404, { message: "Invite not found or expired" });
  return c.json({
    orgName: invite.orgName,
    role: invite.role,
  } satisfies InvitePreview);
});

inviteRoutes.post("/:token/accept", requireUser, async (c) => {
  const db = c.var.db;
  const invite = await lookupInvite(db, c.req.param("token"));

  // Email invites are bound to the address they were sent to; link invites
  // (email null) are bearer links anyone signed in can accept.
  if (invite.email && invite.email !== c.var.user!.email.toLowerCase())
    throw new HTTPException(403, {
      message:
        "This invite was sent to a different email address: sign in with the invited account",
    });

  // The cap may have been reached (or the plan downgraded) since the invite
  // was created; recheck against actual members at accept time. Both that
  // recheck and the "already a member" check happen inside one atomic
  // statement (see issue #18), so two concurrent accepts (or a retried one)
  // can't both pass separate pre-checks.
  const { limits } = await orgPlan(db, invite.orgId);
  const accepted = await acceptInviteAtomically(c.env, {
    orgId: invite.orgId,
    userId: c.var.user!.id,
    role: invite.role,
    ts: Date.now(),
    memberLimit: limits.members,
  });
  if (!accepted) {
    const existing = await db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.orgId, invite.orgId),
          eq(schema.orgMembers.userId, c.var.user!.id),
        ),
      );
    if (existing.length) throw new HTTPException(409, { message: "Already a member of this org" });
    throw new HTTPException(402, {
      message: "This organization is full on its current plan",
    });
  }
  await db
    .update(schema.invites)
    .set({ acceptedBy: c.var.user!.id })
    .where(eq(schema.invites.token, invite.token));
  return c.json({ orgId: invite.orgId });
});
