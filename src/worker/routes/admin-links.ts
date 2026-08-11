/**
 * Cross-org link moderation (#67).
 *
 * A shortener is phishing and malware infrastructure by default, and until
 * now the only answer to an abuse report was deleting the whole organization.
 * That destroys a possibly-legitimate customer's other links to deal with one
 * bad one, and it cannot be undone.
 *
 * Everything here is admin-only and 404s for everyone else, matching the rest
 * of /api/admin: a 403 confirms the route exists.
 *
 * Suspension itself is enforced in storage.ts's desiredKvValue, not here.
 * These routes set the flag and republish; the republish is what stops the
 * redirect, and because every future republish runs through the same
 * function, a later edit cannot quietly bring a suspended link back.
 */
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull, isNotNull, like, or, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { enqueueStorage, syncLinkMsg } from "../storage";
import { recordAdminAction } from "../audit";
import { jsonBodyLimit } from "../body-limit";
import {
  ADMIN_LINK_SORTS,
  type AdminActionRow,
  type AdminAnonLinkRow,
  type AdminLinkRow,
  type AdminLinkSort,
} from "@/shared/types";

export const adminLinkRoutes = new Hono<AppEnv>();
adminLinkRoutes.use("*", jsonBodyLimit());

const MAX_ROWS = 200;

function parseReasons(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

const clickCount = sql<number>`(
  select count(*) from clicks where clicks.link_id = links.id
)`;

/**
 * Every address a link answers to, so suspending or restoring one republishes
 * all of them. A link with three aliases that only republished its primary
 * would keep redirecting on the other two.
 */
async function addressesOf(db: DB, linkId: string) {
  return db
    .select({
      slug: schema.linkAddresses.slug,
      hostname: schema.domains.hostname,
    })
    .from(schema.linkAddresses)
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(and(eq(schema.linkAddresses.linkId, linkId), isNull(schema.linkAddresses.retiredAt)));
}

async function republish(env: Env, db: DB, linkId: string): Promise<number> {
  const addresses = await addressesOf(db, linkId);
  if (addresses.length > 0)
    await enqueueStorage(
      env,
      addresses.map((a) => syncLinkMsg(a.slug, a.hostname)),
    );
  return addresses.length;
}

/**
 * The cross-org search. Matches a slug or a destination, which are the two
 * things an abuse report actually contains.
 *
 * `like` on destination rather than a parsed host: a report usually names a
 * domain, and the destination column holds a full URL, so a substring match
 * finds it wherever in the URL it sits. It is a moderation tool used by one
 * person, not a hot path.
 */
adminLinkRoutes.get("/", async (c) => {
  const db = c.var.db;
  const q = (c.req.query("q") ?? "").trim();
  const sortParam = c.req.query("sort") ?? "created";
  const sort: AdminLinkSort = (ADMIN_LINK_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as AdminLinkSort)
    : "created";
  const onlySuspended = c.req.query("suspended") === "1";

  const filters = [
    q ? or(like(schema.links.slug, `%${q}%`), like(schema.links.destination, `%${q}%`)) : undefined,
    onlySuspended ? isNotNull(schema.links.suspendedAt) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: schema.links.id,
      slug: schema.links.slug,
      domain: schema.domains.hostname,
      destination: schema.links.destination,
      orgId: schema.links.orgId,
      orgName: schema.orgs.name,
      createdBy: schema.links.createdBy,
      createdAt: schema.links.createdAt,
      clicks: clickCount,
      suspendedAt: schema.links.suspendedAt,
      suspendReason: schema.links.suspendReason,
      riskScore: schema.links.riskScore,
      riskReasons: schema.links.riskReasons,
      riskCheckedAt: schema.links.riskCheckedAt,
    })
    .from(schema.links)
    .innerJoin(schema.orgs, eq(schema.links.orgId, schema.orgs.id))
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(filters.length ? and(...filters) : undefined)
    // Nulls last on risk: unscored is not "safe", and letting it sort above a
    // score of 100 would put the worst links below links nobody has looked at.
    .orderBy(
      sort === "clicks"
        ? desc(clickCount)
        : sort === "risk"
          ? sql`${schema.links.riskScore} is null, ${schema.links.riskScore} desc`
          : desc(schema.links.createdAt),
    )
    .limit(MAX_ROWS);

  return c.json(
    rows.map((r) => ({ ...r, riskReasons: parseReasons(r.riskReasons) })) satisfies AdminLinkRow[],
  );
});

async function setSuspended(
  c: Context<AppEnv>,
  linkId: string,
  suspend: boolean,
  reason: string | null,
) {
  const db = c.var.db;
  const rows = await db.select().from(schema.links).where(eq(schema.links.id, linkId));
  const link = rows[0];
  if (!link) throw new HTTPException(404, { message: "Link not found" });

  await db
    .update(schema.links)
    .set({
      suspendedAt: suspend ? Date.now() : null,
      suspendedBy: suspend ? c.var.user!.id : null,
      suspendReason: suspend ? reason : null,
    })
    .where(eq(schema.links.id, linkId));

  const addresses = await republish(c.env, db, linkId);
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: suspend ? "link.suspend" : "link.unsuspend",
    targetType: "link",
    targetId: linkId,
    // The slug and org travel with the entry: the row may be deleted later,
    // and "suspended some link" is not an audit trail.
    detail: {
      slug: link.slug,
      orgId: link.orgId,
      destination: link.destination,
      reason,
      addresses,
    },
  });
  return { addresses };
}

adminLinkRoutes.post("/:linkId/suspend", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) throw new HTTPException(400, { message: "A reason is required" });
  return c.json(await setSuspended(c, c.req.param("linkId")!, true, reason));
});

adminLinkRoutes.post("/:linkId/unsuspend", async (c) =>
  c.json(await setSuspended(c, c.req.param("linkId")!, false, null)),
);

/**
 * Suspend or restore every link in one org, without deleting it.
 *
 * For when the whole account is bad but the evidence should survive and an
 * appeal should be possible. Deleting the org is still available and still
 * irreversible; this is the reversible version.
 */
adminLinkRoutes.post("/orgs/:orgId/suspend", async (c) => {
  const suspend = c.req.query("suspend") !== "0";
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (suspend && !reason) throw new HTTPException(400, { message: "A reason is required" });

  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  const links = await db
    .select({ id: schema.links.id })
    .from(schema.links)
    .where(
      and(
        eq(schema.links.orgId, orgId),
        suspend ? isNull(schema.links.suspendedAt) : isNotNull(schema.links.suspendedAt),
      ),
    );

  if (links.length > 0) {
    await db
      .update(schema.links)
      .set({
        suspendedAt: suspend ? Date.now() : null,
        suspendedBy: suspend ? c.var.user!.id : null,
        suspendReason: suspend ? reason : null,
      })
      .where(
        and(
          eq(schema.links.orgId, orgId),
          suspend ? isNull(schema.links.suspendedAt) : isNotNull(schema.links.suspendedAt),
        ),
      );
    // One republish per link, after the flag is written, so a message
    // consumed early cannot read the old value.
    for (const link of links) await republish(c.env, db, link.id);
  }

  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: suspend ? "org.suspend_links" : "org.unsuspend_links",
    targetType: "org",
    targetId: orgId,
    detail: { count: links.length, reason },
  });
  return c.json({ count: links.length });
});

/**
 * Anonymous links from the landing page (Direction A of #96).
 *
 * They live in their own table with no org and no owner, so they cannot
 * appear in the list above, but an abuse report naming a slug will not know
 * or care which table it came from. Listed here so there is one screen to
 * check.
 *
 * Deleting one is the only action: they expire in 24 hours anyway, and
 * suspending something that is about to vanish is bookkeeping nobody reads.
 */
adminLinkRoutes.get("/anonymous", async (c) => {
  const rows = await c.var.db
    .select({
      id: schema.anonLinks.id,
      slug: schema.anonLinks.slug,
      destination: schema.anonLinks.destination,
      createdAt: schema.anonLinks.createdAt,
      expiresAt: schema.anonLinks.expiresAt,
      riskScore: schema.anonLinks.riskScore,
      riskReasons: schema.anonLinks.riskReasons,
    })
    .from(schema.anonLinks)
    .orderBy(desc(schema.anonLinks.createdAt))
    .limit(MAX_ROWS);

  return c.json(
    rows.map((r) => ({
      ...r,
      riskReasons: parseReasons(r.riskReasons),
    })) satisfies AdminAnonLinkRow[],
  );
});

adminLinkRoutes.delete("/anonymous/:id", async (c) => {
  const db = c.var.db;
  const id = c.req.param("id")!;
  const rows = await db.select().from(schema.anonLinks).where(eq(schema.anonLinks.id, id));
  const anon = rows[0];
  if (!anon) throw new HTTPException(404, { message: "Link not found" });

  await db.delete(schema.anonLinks).where(eq(schema.anonLinks.id, id));
  // The row is gone, so the KV key would resolve to nothing on its next
  // sync; this makes that immediate rather than eventual.
  await enqueueStorage(c.env, [syncLinkMsg(anon.slug, null)]);
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "anon_link.delete",
    targetType: "anon_link",
    targetId: id,
    detail: { slug: anon.slug, destination: anon.destination },
  });
  return c.json({ ok: true });
});

/** The audit log, newest first, optionally narrowed to one target. */
adminLinkRoutes.get("/audit", async (c) => {
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
    .limit(MAX_ROWS);
  return c.json(rows satisfies AdminActionRow[]);
});
