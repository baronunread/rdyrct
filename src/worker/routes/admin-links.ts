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
import { oneOf } from "../../shared/lookup";
import type { JsonValue } from "../../shared/types";
import { optionalFlag, optionalText, parseBody, parseOptionalBody } from "../schemas";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull, isNotNull, like, or, sql, type SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB } from "../env";
import { enqueueStorage, republishLink, republishOrgLinks, syncLinkMsg } from "../storage";
import {
  WARN_REASON,
  adoptWarning,
  clearLinkWarning,
  clearOrgAutomaticWarnings,
  warnLink,
} from "../link-warning";
import { linkClicksTotal } from "../rollups";
import { activeAddressesOf } from "./links";
import { recordAdminAction } from "../audit";
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

/** The risk reasons a link row stores, as JSON. Anything else in that column
 * reads as no reasons rather than as a crash. */
const reasonsSchema = v.fallback(v.array(v.string()), []);

/** The reason a moderation action carries. */
const reasonBodySchema = v.object({ reason: optionalText });

/** The same, plus which way the state change goes. */
const suspensionBodySchema = v.object({ reason: optionalText, suspended: optionalFlag });

/** Which way a warning change goes. No reason: it is one click either way. */
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

/** The columns a suspension writes, or clears. Shared by the single-link and
 * whole-org routes so the two can never set them differently. */
function suspensionPatch(suspend: boolean, actorId: string, reason: string | null) {
  return {
    suspendedAt: suspend ? Date.now() : null,
    suspendedBy: suspend ? actorId : null,
    suspendReason: suspend ? reason : null,
  };
}

/** The reason a moderation action must carry. Suspending without one leaves
 * a decision nobody can account for later. */
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

/** Open reports, as a test rather than a count. */
const reported = sql<boolean>`exists (
  select 1 from link_reports
  where link_reports.link_id = links.id and link_reports.status = 'open'
)`;

/**
 * On a blocklist because Google Web Risk said so: the score that blocks and
 * a `web_risk_*` reason (risk.ts). `like` over the stored JSON rather than
 * json_each, which throws on a malformed row where parseReasons shrugs. (`_`
 * matches any one character in `like`, which only ever widens this to a
 * reason nobody writes.)
 * Literal `links.` columns: this runs inside an aggregate below too.
 */
const flagged = sql<boolean>`(links.risk_score >= 100 and links.risk_reasons like '%"web_risk_%')`;

// Read from the rollups (#26), like the org's own links list.
const clickCount = linkClicksTotal;

/** The link this route is about, or a 404. Every route here starts by
 * reading the row it names, and an id that matches nothing is the same
 * answer in all of them. */
async function requireLink(db: DB, linkId: string) {
  const rows = await db.select().from(schema.links).where(eq(schema.links.id, linkId));
  const link = rows[0];
  if (!link) throw new HTTPException(404, { message: "Link not found" });
  return link;
}

/** The link named by the route's `:linkId`, logged on the request, or a 404. */
async function routeLink(c: Context<AppEnv>) {
  const db = c.var.db;
  const linkId = c.req.param("linkId")!;
  c.get("log").set({ linkId });
  return { db, linkId, link: await requireLink(db, linkId) };
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
/**
 * What the search narrows to.
 *
 * The organization goes in here rather than in the browser: the page used to
 * narrow the rows this query had already capped at 200, so "show me this
 * organization's links" meant "show me whichever of its links happen to be
 * in the newest 200 across every organization on the instance". For a busy
 * instance, or a big account, that is usually none of them, and answering an
 * abuse report with an empty table is worse than answering it slowly.
 */
function adminLinkScope(c: Context<AppEnv>) {
  const q = (c.req.query("q") ?? "").trim();
  const org = (c.req.query("org") ?? "").trim();
  return [
    q ? or(like(schema.links.slug, `%${q}%`), like(schema.links.destination, `%${q}%`)) : undefined,
    org ? eq(schema.links.orgId, org) : undefined,
  ].filter(Boolean);
}

/** The scope above, narrowed by the filter pills. */
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

/** A count of the rows matching `test`, as one column of a single pass. */
const countWhere = (test: SQL) =>
  sql<number>`coalesce(sum(case when ${test} then 1 else 0 end), 0)`;

/** Nulls last on risk: unscored is not "safe", and letting it sort above a
 * score of 100 would put the worst links below links nobody has looked at. */
function adminLinkOrder(sort: AdminLinkSort) {
  if (sort === "clicks") return desc(clickCount);
  if (sort === "risk")
    return sql`${schema.links.riskScore} is null, ${schema.links.riskScore} desc`;
  return desc(schema.links.createdAt);
}

/**
 * How many links each filter pill holds, under the list's search and org.
 * The list stops at MAX_ROWS, so its length cannot say this past 200.
 */
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

/**
 * An org whose links were suspended as a whole (the sweep, or an admin) is
 * still write-blocked and still in the sweep's sights after its links are
 * restored one by one. Restoring is a human decision, so mark the org
 * cleared, and lift the block once no suspended link is left.
 *
 * Only for such an org: restoring a single link in an otherwise normal org
 * must not switch off the automatic checks for it.
 */
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

/**
 * Refuse to restore links in an org whose owner is banned. The org stays
 * disabled whatever its links say, so a restore would change nothing now,
 * and an unban would then bring those links back live without a review,
 * held ones included. Every restore path calls this: one link, several, a
 * whole org. `orgs` picks the org rows to check.
 */
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

/**
 * Suspend or restore one link.
 *
 * One state change, so one endpoint (#104): `{ suspended }` says which way,
 * and a reason is required to suspend but meaningless to undo.
 */
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

/**
 * Put a warning on one link, or take it off (#344). One click either way and
 * no reason asked: the link keeps working, so this is a lighter call than a
 * suspension, and the row records that an admin made it.
 */
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

/** Open public reports, newest first. */
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
    })
    .from(schema.linkReports)
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.linkReports.orgId))
    .where(eq(schema.linkReports.status, "open"))
    .orderBy(desc(schema.linkReports.createdAt))
    .limit(MAX_ROWS);
  return c.json(rows satisfies AdminReportRow[]);
});

/** Close a report without acting on it. Kept, not deleted: the count of
 * dismissed reports on a link is evidence too. */
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

/** Hosts nobody may link to. Listed so a mistaken entry can be removed. */
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
  // A pasted URL or a bare host both work; what is stored is the host.
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

/** Clear an org's "needs review" flag: somebody looked and it is fine. */
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
  // And the warnings the reports and the sweep put on its links: somebody
  // looked and found nothing. A warning an admin set by hand stays.
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

/**
 * Restore several links at once, for the aftermath of a sweep that suspended
 * a whole org's worth. Restore only: suspending needs a reason per decision.
 * Each link goes through setSuspended so it is republished and audited the
 * same as a single restore.
 */
adminLinkRoutes.post("/restore", async (c) => {
  const log = c.get("log");
  const { ids } = parseBody(
    v.object({ ids: v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(MAX_ROWS)) }),
    await c.req.json<JsonValue>().catch(() => ({})),
  );
  log.set({ restoreCount: ids.length });
  // Checked for the whole batch first, so a refusal restores none of them
  // rather than whichever links happened to finish before it. The ids go in
  // as one bound parameter: D1 allows 100 a query, and a batch holds up to
  // MAX_ROWS.
  await assertOrgsNotDisabled(
    c.var.db,
    sql`${schema.orgs.id} in (select org_id from links where id in (select value from json_each(${JSON.stringify(ids)})))`,
  );
  await Promise.all(ids.map((id) => setSuspended(c, id, false, null)));
  return c.json({ count: ids.length });
});

/**
 * Re-run the destination check on demand (#68).
 *
 * Awaited rather than deferred to waitUntil, unlike the checks on create and
 * edit: an admin who asked for this is looking at the row and wants the
 * answer, not a promise that something will happen shortly. One DNS lookup,
 * and one Web Risk lookup when the key is set, each with a three second
 * ceiling. A hit here holds nothing: the admin is the one deciding.
 *
 * Recorded in the audit log because it writes to the row. Reconstructing why
 * a score changed is exactly what that log is for, and "somebody re-checked
 * it at 02:14" is part of the answer.
 */
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

  // A null verdict is "still unscored", never "clean": the provider was
  // unreachable or answered something we do not recognise, and the row keeps
  // whatever it had.
  return c.json({
    scored: !!verdict,
    score: verdict?.score ?? null,
    reasons: verdict?.reasons ?? [],
  });
});

/**
 * Delete a link outright.
 *
 * Suspension is the usual answer, because it is reversible and keeps the
 * evidence. This exists for the cases where the row itself should not
 * survive, and it is deliberately the second option in the menu rather than
 * the first: clicks cascade with it and nothing here can put it back.
 */
adminLinkRoutes.delete("/:linkId", async (c) => {
  const { db, linkId, link } = await routeLink(c);

  // Addresses first: after the row is gone there is nothing to read them
  // from, and each one is a live KV key until it is swept.
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

/**
 * Suspend or restore every link in one org, without deleting it.
 *
 * For when the whole account is bad but the evidence should survive and an
 * appeal should be possible. Deleting the org is still available and still
 * irreversible; this is the reversible version.
 */
adminLinkRoutes.post("/orgs/:orgId/suspend", async (c) => {
  const log = c.get("log");
  const suspend = c.req.query("suspend") !== "0";
  log.set({ orgId: c.req.param("orgId"), suspend });
  const reason = await requiredReason(c, suspend);

  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  if (!suspend) await assertOrgsNotDisabled(db, eq(schema.orgs.id, orgId));
  // Set (or cleared) unconditionally, same as abuse.ts's suspendOrgLinks:
  // requireOrgRole reads this on every write, so a suspended org cannot mint
  // a replacement link before its links are individually caught up below.
  await db
    .update(schema.orgs)
    // A decision either way answers the review flag.
    // Restoring is a human decision the sweep must not undo; suspending is
    // the opposite decision and removes any earlier clearance.
    .set({
      linksSuspendedAt: suspend ? Date.now() : null,
      reviewFlaggedAt: null,
      clearedAt: suspend ? null : Date.now(),
    })
    .where(eq(schema.orgs.id, orgId));

  // One expression, used to select and then to update: built twice they can
  // drift, and a drift here means updating rows the count never mentioned.
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
    // After the flag is written, so a message consumed early cannot read the
    // old value.
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
