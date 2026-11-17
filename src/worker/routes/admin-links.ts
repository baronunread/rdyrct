// Admin-only, 404 for everyone else (a 403 confirms the route exists) (#67). Suspension is enforced in
// storage.ts's desiredKvValue: these routes set the flag and republish, so a later republish
// cannot quietly bring a suspended link back.
import { Hono, type Context } from "hono";
import { oneOf } from "../../shared/lookup";
import type { JsonValue } from "../../shared/types";
import { optionalFlag, optionalText, parseBody, parseOptionalBody } from "../schemas";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull, isNotNull, like, or, sql, type SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB } from "../env";
import {
  enqueueStorage,
  republishLink,
  republishLinks,
  republishOrgLinks,
  syncLinkMsg,
} from "../storage";
import {
  WARN_REASON,
  adoptWarning,
  clearLinkWarning,
  clearOrgAutomaticWarnings,
  warnLink,
} from "../link-warning";
import { linkClicksTotal } from "../rollups";
import { activeAddressesOf } from "./links";
import { recordAdminAction, recordAdminActions } from "../audit";
import { blockable, blockHostOf } from "../../shared/abuse-rules";
import { scoreDestinationWithWebRisk, webRiskAnswered } from "../risk";
import { jsonBodyLimit } from "../body-limit";
import { linkUrl } from "../util";
import {
  ADMIN_LINK_SORTS,
  type AdminAnonLinkRow,
  type AdminLinkCounts,
  type AdminLinkRow,
  type AdminLinkSort,
  type AdminReportRow,
  type AdminBlockedHostRow,
} from "@/shared/types";

export const adminLinkRoutes = new Hono<AppEnv>();
adminLinkRoutes.use("*", jsonBodyLimit());

const reasonsSchema = v.fallback(v.array(v.string()), []);

const reasonBodySchema = v.object({ reason: optionalText });

const suspensionBodySchema = v.object({ reason: optionalText, suspended: optionalFlag });

const warningBodySchema = v.object({ warned: optionalFlag });

const MAX_ROWS = 200;

function parseReasons(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return v.parse(reasonsSchema, JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Shared by the single-link and whole-org routes so they never set them differently. */
function suspensionPatch(suspend: boolean, actorId: string, reason: string | null) {
  return {
    suspendedAt: suspend ? Date.now() : null,
    suspendedBy: suspend ? actorId : null,
    suspendReason: suspend ? reason : null,
  };
}

function checkReason(raw: string, required: boolean): string {
  const reason = raw.trim().slice(0, 500);
  if (required && !reason) throw new HTTPException(400, { message: "A reason is required" });
  return reason;
}

async function requiredReason(c: Context<AppEnv>, required: boolean): Promise<string> {
  const body = parseOptionalBody(reasonBodySchema, await c.req.json<JsonValue>().catch(() => ({})));
  return checkReason(body.reason, required);
}

const reportCount = sql<number>`(
  select count(*) from link_reports
  where link_reports.link_id = links.id and link_reports.status = 'open'
)`;

const reported = sql<boolean>`exists (
  select 1 from link_reports
  where link_reports.link_id = links.id and link_reports.status = 'open'
)`;

// `like` over the stored JSON, not json_each, which throws on a malformed row where parseReasons
// shrugs. Literal `links.` columns: this runs inside an aggregate too.
const flagged = sql<boolean>`(links.risk_score >= 100 and links.risk_reasons like '%"web_risk_%')`;

const clickCount = linkClicksTotal;

async function requireLink(db: DB, linkId: string) {
  const rows = await db.select().from(schema.links).where(eq(schema.links.id, linkId));
  const link = rows[0];
  if (!link) throw new HTTPException(404, { message: "Link not found" });
  return link;
}

async function routeLink(c: Context<AppEnv>) {
  const db = c.var.db;
  const linkId = c.req.param("linkId")!;
  c.get("log").set({ linkId });
  return { db, linkId, link: await requireLink(db, linkId) };
}

// `like` on destination: a report names a domain, and a substring match finds it anywhere in the URL.
// The organization narrows here, not in the browser: the browser would narrow rows already capped
// at 200, which on a busy instance is usually none of that org's links.
function adminLinkScope(c: Context<AppEnv>) {
  const q = (c.req.query("q") ?? "").trim();
  const org = (c.req.query("org") ?? "").trim();
  return [
    q ? or(like(schema.links.slug, `%${q}%`), like(schema.links.destination, `%${q}%`)) : undefined,
    org ? eq(schema.links.orgId, org) : undefined,
  ].filter(Boolean);
}

function adminLinkFilters(c: Context<AppEnv>) {
  return [
    ...adminLinkScope(c),
    c.req.query("suspended") === "1" ? isNotNull(schema.links.suspendedAt) : undefined,
    c.req.query("suspended") === "0" ? isNull(schema.links.suspendedAt) : undefined,
    c.req.query("warned") === "1" ? isNotNull(schema.links.warnedAt) : undefined,
    c.req.query("reported") === "1" ? reported : undefined,
    c.req.query("flagged") === "1" ? flagged : undefined,
  ].filter(Boolean);
}

const countWhere = (test: SQL) =>
  sql<number>`coalesce(sum(case when ${test} then 1 else 0 end), 0)`;

/** Nulls last on risk: unscored is not "safe", so it must not sort above a score of 100. */
function adminLinkOrder(sort: AdminLinkSort) {
  if (sort === "clicks") return desc(clickCount);
  if (sort === "risk")
    return sql`${schema.links.riskScore} is null, ${schema.links.riskScore} desc`;
  return desc(schema.links.createdAt);
}

// The list stops at MAX_ROWS, so its length cannot say this past 200.
adminLinkRoutes.get("/counts", async (c) => {
  const scope = adminLinkScope(c);
  const [row] = await c.var.db
    .select({
      all: sql<number>`count(*)`,
      reported: countWhere(reported),
      flagged: countWhere(flagged),
      suspended: countWhere(isNotNull(schema.links.suspendedAt)),
      warned: countWhere(isNotNull(schema.links.warnedAt)),
    })
    .from(schema.links)
    .where(scope.length ? and(...scope) : undefined);
  return c.json(
    (row ?? { all: 0, reported: 0, flagged: 0, suspended: 0, warned: 0 }) satisfies AdminLinkCounts,
  );
});

adminLinkRoutes.get("/", async (c) => {
  const log = c.get("log");
  const db = c.var.db;
  const sortParam = c.req.query("sort") ?? "created";
  log.set({ linkSort: sortParam });
  const sort = oneOf(ADMIN_LINK_SORTS, sortParam, "created");
  const filters = adminLinkFilters(c);

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
      warnedAt: schema.links.warnedAt,
      warnReason: schema.links.warnReason,
      riskScore: schema.links.riskScore,
      riskReasons: schema.links.riskReasons,
      riskCheckedAt: schema.links.riskCheckedAt,
      reportCount,
    })
    .from(schema.links)
    .innerJoin(schema.orgs, eq(schema.links.orgId, schema.orgs.id))
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(adminLinkOrder(sort))
    .limit(MAX_ROWS);

  return c.json(
    rows.map((r) => ({
      ...r,
      url: linkUrl(c.env, r.domain, r.slug),
      riskReasons: parseReasons(r.riskReasons),
    })) satisfies AdminLinkRow[],
  );
});

// An org suspended as a whole stays write-blocked after its links are restored one by one.
// Restoring is a human decision: mark the org cleared and lift the block once no suspended
// link is left. Only for such an org, not for a single restore in a normal one.
async function clearOrgAfterRestore(db: DB, orgId: string) {
  await db
    .update(schema.orgs)
    .set({
      clearedAt: Date.now(),
      linksSuspendedAt: sql`case when exists (
        select 1 from links where links.org_id = ${orgId} and links.suspended_at is not null
      ) then links_suspended_at else null end`,
    })
    .where(and(eq(schema.orgs.id, orgId), isNotNull(schema.orgs.linksSuspendedAt)));
}

// Refuse to restore links in an org whose owner is banned: the org stays disabled, so an unban
// would bring those links back live without review, held ones included. Every restore path calls this.
async function assertOrgsNotDisabled(db: DB, orgs: SQL): Promise<void> {
  const disabled = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(and(orgs, isNotNull(schema.orgs.disabledAt)))
    .limit(1);
  if (disabled.length > 0)
    throw new HTTPException(409, {
      message: "Its owner is banned. Unban them to bring the links back.",
    });
}

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
  if (!suspend) await assertOrgsNotDisabled(db, eq(schema.orgs.id, link.orgId));

  await db
    .update(schema.links)
    .set(suspensionPatch(suspend, c.var.user!.id, reason))
    .where(eq(schema.links.id, linkId));

  if (!suspend) await clearOrgAfterRestore(db, link.orgId);

  // Written to KV in this request, not left to the queue (#101).
  const addresses = await republishLink(c.env, db, linkId, { recheck: true });
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: suspend ? "link.suspend" : "link.unsuspend",
    targetType: "link",
    targetId: linkId,
    // The slug and org travel with the entry: the row may be deleted later.
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

adminLinkRoutes.patch("/:linkId", async (c) => {
  const log = c.get("log");
  log.set({ linkId: c.req.param("linkId") });
  const body = parseOptionalBody(
    suspensionBodySchema,
    await c.req.json<JsonValue>().catch(() => ({})),
  );
  if (body.suspended == null)
    throw new HTTPException(400, { message: "Say whether to suspend or restore this link" });
  const reason = body.suspended ? checkReason(body.reason, true) : null;
  return c.json(await setSuspended(c, c.req.param("linkId")!, body.suspended, reason));
});

adminLinkRoutes.patch("/:linkId/warning", async (c) => {
  const body = parseOptionalBody(
    warningBodySchema,
    await c.req.json<JsonValue>().catch(() => ({})),
  );
  if (body.warned == null)
    throw new HTTPException(400, { message: "Say whether to warn or clear this link" });
  const { db, linkId, link } = await routeLink(c);
  if (body.warned && link.suspendedAt !== null)
    throw new HTTPException(409, { message: "This link is suspended. Restore it first." });
  const changed = body.warned
    ? (await warnLink(c.env, db, linkId, WARN_REASON.admin)) || (await adoptWarning(db, linkId))
    : await clearLinkWarning(c.env, db, linkId);
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: body.warned ? "link.warn" : "link.unwarn",
    targetType: "link",
    targetId: linkId,
    detail: { slug: link.slug, orgId: link.orgId, destination: link.destination, changed },
  });
  return c.json({ warned: body.warned });
});

adminLinkRoutes.get("/reports", async (c) => {
  const rows = await c.var.db
    .select({
      id: schema.linkReports.id,
      slug: schema.linkReports.slug,
      linkId: schema.linkReports.linkId,
      orgId: schema.linkReports.orgId,
      orgName: schema.orgs.name,
      reason: schema.linkReports.reason,
      note: schema.linkReports.note,
      contact: schema.linkReports.contact,
      createdAt: schema.linkReports.createdAt,
      anonLinkId: schema.linkReports.anonLinkId,
    })
    .from(schema.linkReports)
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.linkReports.orgId))
    .where(eq(schema.linkReports.status, "open"))
    .orderBy(desc(schema.linkReports.createdAt))
    .limit(MAX_ROWS);
  return c.json(
    rows.map(({ anonLinkId, ...row }) => ({
      ...row,
      anonymous: anonLinkId !== null,
    })) satisfies AdminReportRow[],
  );
});

adminLinkRoutes.post("/reports/:id/dismiss", async (c) => {
  const id = c.req.param("id")!;
  c.get("log").set({ reportId: id });
  const done = await c.var.db
    .update(schema.linkReports)
    .set({ status: "dismissed" })
    .where(eq(schema.linkReports.id, id))
    .returning({ linkId: schema.linkReports.linkId });
  if (done.length === 0) throw new HTTPException(404, { message: "Report not found" });
  // The last open report on a link takes its warning with it, if a report is
  // what put the warning there. An admin's own warning stays.
  const linkId = done[0]?.linkId;
  if (linkId && !(await hasOpenReport(c.var.db, linkId)))
    await clearLinkWarning(c.env, c.var.db, linkId, WARN_REASON.report);
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "report.dismiss",
    targetType: "report",
    targetId: id,
    detail: {},
  });
  return c.json({ ok: true });
});

async function hasOpenReport(db: DB, linkId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.linkReports.id })
    .from(schema.linkReports)
    .where(and(eq(schema.linkReports.linkId, linkId), eq(schema.linkReports.status, "open")))
    .limit(1);
  return rows.length > 0;
}

const blockedHostBodySchema = v.object({ host: optionalText, reason: optionalText });

adminLinkRoutes.get("/blocked-hosts", async (c) => {
  const rows = await c.var.db
    .select({
      host: schema.blockedHosts.host,
      reason: schema.blockedHosts.reason,
      createdAt: schema.blockedHosts.createdAt,
    })
    .from(schema.blockedHosts)
    .orderBy(desc(schema.blockedHosts.createdAt))
    .limit(MAX_ROWS);
  return c.json(rows satisfies AdminBlockedHostRow[]);
});

adminLinkRoutes.post("/blocked-hosts", async (c) => {
  const body = parseBody(blockedHostBodySchema, await c.req.json<JsonValue>().catch(() => ({})));
  const host = blockHostOf(body.host.includes("://") ? body.host : `https://${body.host.trim()}`);
  if (!host || !host.includes("."))
    throw new HTTPException(400, { message: "Enter a host such as scam.example.com" });
  if (!blockable(host))
    throw new HTTPException(422, {
      message: `${host} is a site everyone uses, so it cannot be blocked.`,
    });
  const reason = checkReason(body.reason, true);
  await c.var.db
    .insert(schema.blockedHosts)
    .values({ host, reason, createdBy: c.var.user!.id, createdAt: Date.now() })
    .onConflictDoNothing();
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "host.block",
    targetType: "host",
    targetId: host,
    detail: { reason },
  });
  return c.json({ host }, 201);
});

adminLinkRoutes.delete("/blocked-hosts/:host", async (c) => {
  const host = c.req.param("host")!;
  const done = await c.var.db
    .delete(schema.blockedHosts)
    .where(eq(schema.blockedHosts.host, host))
    .returning({ host: schema.blockedHosts.host });
  if (done.length === 0) throw new HTTPException(404, { message: "Host not found" });
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "host.unblock",
    targetType: "host",
    targetId: host,
    detail: {},
  });
  return c.json({ ok: true });
});

adminLinkRoutes.post("/orgs/:orgId/reviewed", async (c) => {
  const orgId = c.req.param("orgId")!;
  c.get("log").set({ orgId });
  const done = await c.var.db
    .update(schema.orgs)
    .set({ reviewFlaggedAt: null, clearedAt: Date.now() })
    .where(eq(schema.orgs.id, orgId))
    .returning({ id: schema.orgs.id });
  if (done.length === 0) throw new HTTPException(404, { message: "Organization not found" });
  // Reviewed means those reports were read. Left open, the next report on the
  // same link would count past the threshold and flag the org again at once.
  await c.var.db
    .update(schema.linkReports)
    .set({ status: "dismissed" })
    .where(and(eq(schema.linkReports.orgId, orgId), eq(schema.linkReports.status, "open")));
  // And the warnings the reports and sweep put on its links. An admin's own warning stays.
  await clearOrgAutomaticWarnings(c.env, c.var.db, orgId);
  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "org.reviewed",
    targetType: "org",
    targetId: orgId,
    detail: {},
  });
  return c.json({ ok: true });
});

// A fixed number of statements for the whole batch (#14): the single-link path per id was
// thousands of D1 statements at MAX_ROWS and died partway.
adminLinkRoutes.post("/restore", async (c) => {
  const log = c.get("log");
  const { ids } = parseBody(
    v.object({ ids: v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(MAX_ROWS)) }),
    await c.req.json<JsonValue>().catch(() => ({})),
  );
  log.set({ restoreCount: ids.length });
  // Checked for the whole batch first, so a refusal restores none. The ids go in as one bound
  // parameter: D1 allows 100 a query and a batch holds up to MAX_ROWS.
  await assertOrgsNotDisabled(
    c.var.db,
    sql`${schema.orgs.id} in (select org_id from links where id in (select value from json_each(${JSON.stringify(ids)})))`,
  );
  const db = c.var.db;
  const picked = sql`${schema.links.id} in (select value from json_each(${JSON.stringify(ids)}))`;
  const links = await db
    .select({
      id: schema.links.id,
      slug: schema.links.slug,
      orgId: schema.links.orgId,
      destination: schema.links.destination,
    })
    .from(schema.links)
    .where(picked);
  // Every id or none: a missing one restores nothing, like a banned owner.
  if (links.length < new Set(ids).size) throw new HTTPException(404, { message: "Link not found" });

  await db
    .update(schema.links)
    .set(suspensionPatch(false, c.var.user!.id, null))
    .where(picked);
  await Promise.all(
    [...new Set(links.map((link) => link.orgId))].map((orgId) => clearOrgAfterRestore(db, orgId)),
  );
  // Small batches are written to KV in this request (#101); bigger ones go
  // to the queue in sends of a hundred.
  const synced = await republishLinks(c.env, db, ids, { recheck: true });
  await recordAdminActions(
    c.env,
    links.map((link) => ({
      actorUserId: c.var.user!.id,
      action: "link.unsuspend",
      targetType: "link",
      targetId: link.id,
      detail: {
        slug: link.slug,
        orgId: link.orgId,
        destination: link.destination,
        reason: null,
        addresses: synced.get(link.id) ?? 0,
      },
    })),
  );
  return c.json({ count: links.length });
});

// Awaited, not waitUntil: the admin is looking at the row and wants the answer. A hit holds
// nothing: the admin decides. Audited because it writes to the row.
adminLinkRoutes.post("/:linkId/rescore", async (c) => {
  const { db, linkId, link } = await routeLink(c);

  const { verdict, webRisk } = await scoreDestinationWithWebRisk(link.destination, c.env);
  c.get("log").set({ webRisk: { outcome: webRisk } });
  if (verdict)
    await db
      .update(schema.links)
      .set({
        riskScore: verdict.score,
        riskReasons: JSON.stringify(verdict.reasons),
        riskCheckedAt: Date.now(),
        riskProvider: verdict.provider,
        ...(webRiskAnswered(webRisk) && { webRiskCheckedAt: Date.now() }),
      })
      .where(eq(schema.links.id, linkId));

  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "link.rescore",
    targetType: "link",
    targetId: linkId,
    detail: { slug: link.slug, destination: link.destination, score: verdict?.score ?? null },
  });

  // A null verdict is "still unscored", never "clean": the provider was unreachable or unrecognised.
  return c.json({
    scored: !!verdict,
    score: verdict?.score ?? null,
    reasons: verdict?.reasons ?? [],
  });
});

// Suspension is the usual answer (reversible, keeps the evidence). Clicks cascade with a delete
// and nothing can put it back.
adminLinkRoutes.delete("/:linkId", async (c) => {
  const { db, linkId, link } = await routeLink(c);

  // Addresses first: after the row is gone nothing is left to read them from.
  const addresses = await activeAddressesOf(db, linkId);
  await db.delete(schema.links).where(eq(schema.links.id, linkId));
  if (addresses.length > 0)
    await enqueueStorage(
      c.env,
      addresses.map((a) => syncLinkMsg(a.slug, a.hostname)),
    );

  await recordAdminAction(c.env, {
    actorUserId: c.var.user!.id,
    action: "link.delete",
    targetType: "link",
    targetId: linkId,
    detail: {
      slug: link.slug,
      orgId: link.orgId,
      destination: link.destination,
      addresses: addresses.length,
    },
  });
  return c.json({ ok: true });
});

adminLinkRoutes.post("/orgs/:orgId/suspend", async (c) => {
  const log = c.get("log");
  const suspend = c.req.query("suspend") !== "0";
  log.set({ orgId: c.req.param("orgId"), suspend });
  const reason = await requiredReason(c, suspend);

  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  if (!suspend) await assertOrgsNotDisabled(db, eq(schema.orgs.id, orgId));
  // Set unconditionally, as in abuse.ts's suspendOrgLinks: requireOrgRole reads it on every write,
  // so a suspended org cannot mint a replacement link.
  await db
    .update(schema.orgs)
    // Restoring is a human decision the sweep must not undo; suspending removes any earlier clearance.
    .set({
      linksSuspendedAt: suspend ? Date.now() : null,
      reviewFlaggedAt: null,
      clearedAt: suspend ? null : Date.now(),
    })
    .where(eq(schema.orgs.id, orgId));

  // One expression for select and update: built twice they can drift.
  const affected = and(
    eq(schema.links.orgId, orgId),
    suspend ? isNull(schema.links.suspendedAt) : isNotNull(schema.links.suspendedAt),
  );
  const links = await db.select({ id: schema.links.id }).from(schema.links).where(affected);

  if (links.length > 0) {
    await db
      .update(schema.links)
      .set(suspensionPatch(suspend, c.var.user!.id, reason))
      .where(affected);
    // After the flag is written, so a message consumed early cannot read the old value.
    await republishOrgLinks(c.env, db, orgId);
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

// Anonymous links have no org, so they are listed here for one screen of checking (#488).
// Deleting is the only action: they expire in 24 hours anyway.
adminLinkRoutes.get("/anonymous", async (c) => {
  const log = c.get("log");
  log.set({ route: "anonymous-links" });
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
  const log = c.get("log");
  const db = c.var.db;
  const id = c.req.param("id")!;
  log.set({ anonLinkId: id });
  const rows = await db.select().from(schema.anonLinks).where(eq(schema.anonLinks.id, id));
  const anon = rows[0];
  if (!anon) throw new HTTPException(404, { message: "Link not found" });

  await db.delete(schema.anonLinks).where(eq(schema.anonLinks.id, id));
  // The row is gone, so this makes the KV key's removal immediate rather than eventual.
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
