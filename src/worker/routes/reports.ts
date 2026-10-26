/**
 * Public abuse reports against a short link.
 *
 * Unauthenticated, so it carries the same defences as the anonymous
 * shortener: Turnstile on its own scope and a per-caller rate limit
 * (the anon-link counter, under a "report:" key so the two never share a
 * count). The answer is the same whether or not the slug exists: a report
 * form that said "no such link" would be a slug probe.
 *
 * A report never suspends anything by itself. Anyone can file one, so a
 * single report could be used to take down a stranger's link. On a free
 * org's link it puts the warning page in front instead (#344): the link
 * keeps working, one click later, until an admin dismisses the report. On a
 * paid org's link it only goes into the admin queue and the link stays as it
 * is: a paying customer went through billing, and one anonymous report must
 * not put an interstitial in front of their link (decided on #390). With no
 * billing (a self-hosted copy) every org is unlimited, so no report warns.
 * A link with REPORTS_TO_FLAG open reports also flags its org for review,
 * and a human decides.
 */
import { Hono } from "hono";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { and, count, eq, isNull } from "drizzle-orm";
import { TURNSTILE_FAILED_CODE, REPORT_REASONS, type JsonValue } from "@/shared/types";
import * as schema from "../db/schema";
import { drizzle } from "drizzle-orm/d1";
import type { AppEnv, DB, Env } from "../env";
import { jsonBodyLimit } from "../body-limit";
import { spendToken } from "../turnstile";
import { optionalText, parseBody } from "../schemas";
import { publicClientKey, rateLimitAllows } from "../rate-limit";
import { captureAlert } from "../sentry";
import { notifyAdmin } from "../abuse";
import { WARN_REASON, warnLink } from "../link-warning";
import { orgPlan } from "../plan";
import { uid } from "../util";

/** Open reports on one link before its org is flagged for review. */
export const REPORTS_TO_FLAG = 3;

const reportBodySchema = v.object({
  link: v.pipe(v.string(), v.trim(), v.minLength(1, "Paste the short link"), v.maxLength(300)),
  reason: v.picklist(REPORT_REASONS, "Pick a reason"),
  note: v.pipe(optionalText, v.maxLength(1000)),
  contact: v.pipe(optionalText, v.maxLength(200)),
  turnstileToken: optionalText,
});

/**
 * The slug, and the host when the reporter pasted a full URL. A bare slug
 * means the shared host. Null when nothing usable is in there.
 */
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

/** The link a reported address points at, or null. */
async function findReportedLink(env: Env, db: DB, raw: string) {
  const parsed = parseReportedLink(raw);
  if (!parsed) return { slug: raw.slice(0, 100), link: null };
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
  return { slug: parsed.slug, link: rows[0] ?? null };
}

/** Flag the link's org for review once enough open reports name the link.
 * Never suspends: anyone can file a report. */
async function flagOrgIfReported(env: Env, db: DB, link: { linkId: string; orgId: string }) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.linkReports)
    .where(and(eq(schema.linkReports.linkId, link.linkId), eq(schema.linkReports.status, "open")));
  // The first report on a link is worth a mail on its own at this volume: a
  // real scam is reported once and then clicked a thousand times.
  if (n === 1)
    await notifyAdmin(
      env,
      "A link was reported",
      [`Organization ${link.orgId}. Open reports on this link: 1.`],
      `/admin/links?org=${encodeURIComponent(link.orgId)}`,
    );
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
    !(await rateLimitAllows(c.env.RL_ANON_LINK, `report:${key}`, {
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
  const { slug, link } = await findReportedLink(c.env, db, body.link);
  await db.insert(schema.linkReports).values({
    id: uid(),
    slug,
    linkId: link?.linkId ?? null,
    orgId: link?.orgId ?? null,
    reason: body.reason,
    note: body.note.trim(),
    contact: body.contact.trim(),
    createdAt: Date.now(),
  });

  if (link) {
    // The plan is the owner's, as everywhere (plan.ts's orgPlan).
    const { plan } = await orgPlan(db, link.orgId);
    log.set({ report: { plan, warned: plan === "free" } });
    if (plan === "free") await warnLink(c.env, db, link.linkId, WARN_REASON.report);
    await flagOrgIfReported(c.env, db, link);
  }

  // The same answer for a real link and a made-up one.
  return c.json({ ok: true }, 201);
});
