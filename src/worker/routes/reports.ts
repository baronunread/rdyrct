// Unauthenticated, so the answer is the same whether or not the slug exists: a form
// saying "no such link" would be a slug probe. A report never suspends by itself.
// Free orgs' links warn after REPORTERS_TO_WARN reporters (#344); paid ones only reach the admin queue (#390).
import { Hono } from "hono";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  max,
  notExists,
  or,
} from "drizzle-orm";
import { TURNSTILE_FAILED_CODE, REPORT_REASONS, type JsonValue } from "@/shared/types";
import * as schema from "../db/schema";
import { drizzle } from "drizzle-orm/d1";
import type { AppEnv, DB, Env } from "../env";
import { jsonBodyLimit } from "../body-limit";
import { spendToken } from "../turnstile";
import { optionalText, parseBody } from "../schemas";
import { keyedDigest, publicClientKey, rateLimitAllows } from "../rate-limit";
import { captureAlert } from "../sentry";
import { notifyAdmin } from "../abuse";
import { clearLinkWarning, WARN_REASON, warnAnonLink, warnLink } from "../link-warning";
import { orgPlan } from "../plan";
import { uid } from "../util";

export const REPORTS_TO_FLAG = 3;

/** Two: one stranger cannot do it alone, and a scam reported once then clicked a thousand times still warns. */
export const REPORTERS_TO_WARN = 2;

/** An admin who wants a warning to stay makes it their own (adoptWarning). */
export const REPORT_WARNING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ReportTarget = typeof schema.linkReports.linkId | typeof schema.linkReports.anonLinkId;

async function reportedEnough(db: DB, column: ReportTarget, id: string) {
  const [{ reporters }] = await db
    .select({ reporters: countDistinct(schema.linkReports.reporterKey) })
    .from(schema.linkReports)
    .where(
      and(
        eq(column, id),
        eq(schema.linkReports.status, "open"),
        gt(schema.linkReports.createdAt, Date.now() - REPORT_WARNING_TTL_MS),
      ),
    );
  return reporters >= REPORTERS_TO_WARN;
}

async function warnIfReportedEnough(env: Env, db: DB, linkId: string) {
  if (!(await reportedEnough(db, schema.linkReports.linkId, linkId))) return false;
  await warnLink(env, db, linkId, WARN_REASON.report);
  return true;
}

const matchedReport = or(
  isNotNull(schema.linkReports.linkId),
  isNotNull(schema.linkReports.anonLinkId),
);

export async function sweepStaleReportWarnings(env: Env): Promise<number> {
  const db = drizzle(env.DB, { schema });
  const stale = await db
    .select({ id: schema.links.id })
    .from(schema.links)
    .where(
      and(
        eq(schema.links.warnReason, WARN_REASON.report),
        lt(schema.links.warnedAt, Date.now() - REPORT_WARNING_TTL_MS),
      ),
    )
    .limit(500);
  let lifted = 0;
  // One link at a time: each clear writes D1 and KV, and 500 at once would put
  // that many subrequests in flight in one cron run.
  // react-doctor-disable-next-line react-doctor/async-await-in-loop
  for (const { id } of stale) if (await clearLinkWarning(env, db, id, WARN_REASON.report)) lifted++;
  return lifted;
}

const reportBodySchema = v.object({
  link: v.pipe(v.string(), v.trim(), v.minLength(1, "Paste the short link"), v.maxLength(300)),
  reason: v.picklist(REPORT_REASONS, "Pick a reason"),
  note: v.pipe(optionalText, v.maxLength(1000)),
  contact: v.pipe(optionalText, v.maxLength(200)),
  turnstileToken: optionalText,
});

export function parseReportedLink(raw: string): { slug: string; host: string | null } | null {
  const input = raw.trim();
  if (!input.includes("/") && !input.includes(".")) return { slug: input, host: null };
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    const slug = url.pathname.split("/").filter(Boolean)[0];
    return slug ? { slug, host: url.host.toLowerCase() } : null;
  } catch {
    return null;
  }
}

// A slug is never both: the shortener checks link_addresses first, and a claim deletes the anonymous row.
async function findReportedLink(env: Env, db: DB, raw: string) {
  const parsed = parseReportedLink(raw);
  if (!parsed) return { slug: raw.slice(0, 100), link: null, anon: null };
  // Both hosts serve shared-domain slugs: the root /:slug route answers on
  // the app host even when a separate short host is set. `host` keeps a port.
  const sharedHosts = [env.SHARED_LINK_HOST, env.APP_HOST].map((h) => h?.toLowerCase());
  const onShared = !parsed.host || sharedHosts.includes(parsed.host);
  const rows = await db
    .select({ linkId: schema.linkAddresses.linkId, orgId: schema.links.orgId })
    .from(schema.linkAddresses)
    .innerJoin(schema.links, eq(schema.links.id, schema.linkAddresses.linkId))
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(
      and(
        eq(schema.linkAddresses.slug, parsed.slug),
        isNull(schema.linkAddresses.retiredAt),
        onShared
          ? isNull(schema.linkAddresses.domainId)
          : eq(schema.domains.hostname, parsed.host!),
      ),
    );
  if (rows[0] || !onShared) return { slug: parsed.slug, link: rows[0] ?? null, anon: null };
  const [anon] = await db
    .select({ id: schema.anonLinks.id })
    .from(schema.anonLinks)
    .where(and(eq(schema.anonLinks.slug, parsed.slug), gt(schema.anonLinks.expiresAt, Date.now())));
  return { slug: parsed.slug, link: null, anon: anon ?? null };
}

/** Anyone can file a report, so a mail per report would let anyone flood the admin. */
export const REPORT_NOTICE_WINDOW_MS = 60 * 60 * 1000;

// The claim is one UPDATE that succeeds only when no report has a recent notified_at,
// so two reports at once cannot both send.
async function noticeReport(env: Env, db: DB, reportId: string, path: string) {
  if (!env.SUPERADMIN_EMAIL) return false;
  const now = Date.now();
  const [{ last }] = await db
    .select({ last: max(schema.linkReports.notifiedAt) })
    .from(schema.linkReports);
  const claimed = await db
    .update(schema.linkReports)
    .set({ notifiedAt: now })
    .where(
      and(
        eq(schema.linkReports.id, reportId),
        notExists(
          db
            .select({ id: schema.linkReports.id })
            .from(schema.linkReports)
            .where(gt(schema.linkReports.notifiedAt, now - REPORT_NOTICE_WINDOW_MS)),
        ),
      ),
    )
    .returning({ id: schema.linkReports.id });
  if (claimed.length === 0) return false;
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.linkReports)
    .where(
      and(
        matchedReport,
        eq(schema.linkReports.status, "open"),
        gt(schema.linkReports.createdAt, last ?? 0),
      ),
    );
  await notifyAdmin(
    env,
    n > 1 ? `${n} links were reported` : "A link was reported",
    [
      `New open reports since the last mail: ${n}.`,
      "At most one of these mails goes out an hour. Admin has every report.",
    ],
    path,
  );
  return true;
}

export async function sweepReportNotices(env: Env): Promise<boolean> {
  const db = drizzle(env.DB, { schema });
  const [{ last }] = await db
    .select({ last: max(schema.linkReports.notifiedAt) })
    .from(schema.linkReports);
  const [pending] = await db
    .select({ id: schema.linkReports.id })
    .from(schema.linkReports)
    .where(
      and(
        matchedReport,
        eq(schema.linkReports.status, "open"),
        isNull(schema.linkReports.notifiedAt),
        gt(schema.linkReports.createdAt, last ?? 0),
      ),
    )
    .orderBy(desc(schema.linkReports.createdAt))
    .limit(1);
  if (!pending) return false;
  return noticeReport(env, db, pending.id, "/admin/links");
}

async function openReportsOn(db: DB, column: ReportTarget, id: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.linkReports)
    .where(and(eq(column, id), eq(schema.linkReports.status, "open")));
  return n;
}

/** Never suspends: anyone can file a report. */
async function flagOrgIfReported(
  env: Env,
  db: DB,
  link: { linkId: string; orgId: string },
  reportId: string,
) {
  const n = await openReportsOn(db, schema.linkReports.linkId, link.linkId);
  // A real scam is reported once and then clicked a thousand times. Bounded to one
  // mail a window; the rest go out together after it.
  if (n === 1)
    await noticeReport(env, db, reportId, `/admin/links?org=${encodeURIComponent(link.orgId)}`);
  if (n < REPORTS_TO_FLAG) return;
  const flagged = await db
    .update(schema.orgs)
    .set({ reviewFlaggedAt: Date.now() })
    .where(and(eq(schema.orgs.id, link.orgId), isNull(schema.orgs.reviewFlaggedAt)))
    .returning({ id: schema.orgs.id });
  if (flagged.length > 0)
    captureAlert([{ event: "org_flagged_by_reports", orgId: link.orgId, reports: n }]);
}

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use("*", jsonBodyLimit());

reportRoutes.post("/", async (c) => {
  const log = c.get("log");
  log.set({ route: "/api/reports" });
  const key = await publicClientKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
  if (
    !(await rateLimitAllows(c.env, "anon_link", `report:${key}`, {
      group: "anon_link",
      method: "POST",
    }))
  )
    throw new HTTPException(429, { message: "Too many reports from here. Try again shortly." });

  const body = parseBody(reportBodySchema, await c.req.json<JsonValue>().catch(() => ({})));
  if (!(await spendToken(c.env, "report", body.turnstileToken)))
    throw new HTTPException(400, {
      message: "Could not verify you are human. Reload the page and try again.",
      cause: { code: TURNSTILE_FAILED_CODE },
    });

  const db = drizzle(c.env.DB, { schema });
  const found = await findReportedLink(c.env, db, body.link);
  const reportId = await storeReport(c.env, db, found, body, key);

  const outcome = await actOnReport(c.env, db, found, reportId);
  if (outcome) log.set({ report: outcome });

  return c.json({ ok: true }, 201);
});

type ReportBody = v.InferOutput<typeof reportBodySchema>;

async function storeReport(
  env: Env,
  db: DB,
  found: Awaited<ReturnType<typeof findReportedLink>>,
  body: ReportBody,
  clientKey: string,
) {
  const { slug, link, anon } = found;
  const reportedId = link?.linkId ?? anon?.id;
  const id = uid();
  await db.insert(schema.linkReports).values({
    id,
    slug,
    linkId: link?.linkId ?? null,
    orgId: link?.orgId ?? null,
    anonLinkId: anon?.id ?? null,
    reason: body.reason,
    note: body.note.trim(),
    contact: body.contact.trim(),
    createdAt: Date.now(),
    // Per link, so the value cannot follow a reporter from one link to the next.
    reporterKey: reportedId
      ? await keyedDigest(env.BETTER_AUTH_SECRET, `report:${reportedId}:${clientKey}`)
      : null,
  });
  return id;
}

async function actOnReport(
  env: Env,
  db: DB,
  found: Awaited<ReturnType<typeof findReportedLink>>,
  reportId: string,
) {
  if (found.link) return actOnLinkReport(env, db, found.link, reportId);
  if (found.anon) return actOnAnonReport(env, db, found.anon.id, reportId);
  return null;
}

async function actOnLinkReport(
  env: Env,
  db: DB,
  link: { linkId: string; orgId: string },
  reportId: string,
): Promise<{ plan: string; warned: boolean }> {
  const { plan } = await orgPlan(db, link.orgId);
  const warned = plan === "free" && (await warnIfReportedEnough(env, db, link.linkId));
  await flagOrgIfReported(env, db, link, reportId);
  return { plan, warned };
}

async function actOnAnonReport(env: Env, db: DB, anonId: string, reportId: string) {
  const warned =
    (await reportedEnough(db, schema.linkReports.anonLinkId, anonId)) &&
    (await warnAnonLink(env, db, anonId));
  if ((await openReportsOn(db, schema.linkReports.anonLinkId, anonId)) === 1)
    await noticeReport(env, db, reportId, "/admin/links");
  return { plan: "anonymous", warned };
}
