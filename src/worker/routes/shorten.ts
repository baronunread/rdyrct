// An unauthenticated write path, so it ships with Turnstile (#304) on "anon-link", its own rate-limit
// namespace (a flood must not lock anybody out of sign-in), scoring (#68) and Web Risk (#341)
// refusal, random slugs only, and a 24-hour life, so the shared namespace cannot be squatted.
import { Hono } from "hono";
import type { JsonValue } from "../../shared/types";
import { optionalText, parseOptionalBody } from "../schemas";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, Env } from "../env";
import { jsonBodyLimit } from "../body-limit";
import { assertDestinationAllowed, holdIfSuspicious, isBlockedHost } from "../abuse-hold";
import { holdReasonFor } from "../../shared/abuse-rules";
import { publishAnonLink, resolveSlug, unpublishLink } from "../kv";
import { askWebRisk, scoreAndRecord, type SpendLookup } from "../risk";
import { checkLinkDestination } from "../destination-check";
import { enqueueStorage, syncLinkMsg } from "../storage";
import { orgLinkWarning } from "../link-warning";
import { spendToken } from "../turnstile";
import { TURNSTILE_FAILED_CODE } from "@/shared/types";
import { isValidHttpUrl, linkUrl, normalizeUrl, uid } from "../util";
import { allocateSharedSlug } from "../shared-slugs";
import { publicClientKey, rateLimitAllows } from "../rate-limit";
import { insertLinkWithinLimit, orgPlan } from "../plan";
import { spendAnonWebRiskLookup, WEB_RISK_NOTICE } from "../destination-check";

const ANON_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const shortenBodySchema = v.object({
  destination: optionalText,
  turnstileToken: optionalText,
});

export const shortenRoutes = new Hono<AppEnv>();
shortenRoutes.use("*", jsonBodyLimit());

shortenRoutes.post("/", async (c) => {
  const log = c.get("log");
  log.set({ route: "/api/shorten" });
  // Its own namespace: a flood here must not lock anybody out of signing in. Keyed by the
  // auth limiter's HMAC, so no raw address reaches storage or logs.
  const key = await publicClientKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
  if (
    !(await rateLimitAllows(c.env, "anon_link", `shorten:${key}`, {
      group: "anon_link",
      method: "POST",
    }))
  )
    throw new HTTPException(429, {
      message: "Too many links from here. Try again shortly, or sign up.",
    });

  const body = parseOptionalBody(
    shortenBodySchema,
    await c.req.json<JsonValue>().catch(() => ({})),
  );

  if (!(await spendToken(c.env, "anon-link", body.turnstileToken)))
    // Coded so the browser can solve again and retry once.
    throw new HTTPException(400, {
      message: "Could not verify you are human. Reload the page and try again.",
      cause: { code: TURNSTILE_FAILED_CODE },
    });

  if (!body.destination.trim())
    throw new HTTPException(400, { message: "Paste a link to shorten" });

  const destination = normalizeUrl(body.destination.trim());
  if (!isValidHttpUrl(destination))
    throw new HTTPException(400, { message: "That does not look like a web address" });
  const db = drizzle(c.env.DB, { schema });
  await assertDestinationAllowed(c.env, db, destination);
  // No org, owner or human review, so a scam-shaped destination is refused outright.
  // Signing up makes it a normal link, which is held for review instead.
  if (holdReasonFor(destination))
    throw new HTTPException(422, {
      message:
        "That destination looks like a scam page, so it cannot be shortened without an account. Sign up and we will review it.",
    });
  // Web Risk (#341) is asked before publishing: there is no org to hold, and the redirect path
  // never re-checks an anonymous link. Each uncached URL spends one of this caller's daily
  // lookups, so one caller cannot spend the site-wide day every org relies on.
  const spendLookup = spendAnonWebRiskLookup(c.env.DB, key);
  const webRisk = await askWebRisk(c.env, destination, spendLookup);
  log.set({ webRisk: { outcome: webRisk.outcome } });
  if (webRisk.outcome === "hit")
    throw new HTTPException(422, {
      // Attribution and the advisory notice: Service Specific Terms §47.
      message: `Google Web Risk lists this site as unsafe, so it cannot be shortened. ${WEB_RISK_NOTICE}`,
    });
  const now = Date.now();
  const expiresAt = now + ANON_LINK_TTL_MS;
  const row = {
    id: uid(),
    slug: await allocateSharedSlug(db),
    destination,
    claimToken: uid() + uid(),
    createdAt: now,
    expiresAt,
    riskScore: null,
    riskReasons: null,
    riskCheckedAt: null,
    riskProvider: null,
  };
  await db.insert(schema.anonLinks).values(row);

  await publishAnonLink(c.env, { ...row, warned: false });

  c.executionCtx.waitUntil(scoreAnonLink(c.env, row.id, destination, spendLookup));

  return c.json(
    {
      slug: row.slug,
      url: linkUrl(c.env, null, row.slug),
      claimToken: row.claimToken,
      expiresAt,
    },
    201,
  );
});

/** A header, not a query parameter, so the token stays out of logs. */
const CLAIM_TOKEN_HEADER = "x-claim-token";

// Keyed by the claim token, not the slug, so nobody reads another link's count. Unknown and
// expired tokens are the same 404. Every token costs a D1 read, so callers are limited first,
// under a `clicks:` key so polling never spends the link-making budget.
shortenRoutes.get("/clicks", async (c) => {
  const token = c.req.header(CLAIM_TOKEN_HEADER);
  if (!token) throw new HTTPException(404, { message: "No such link" });
  const key = await publicClientKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
  if (
    !(await rateLimitAllows(c.env, "anon_link", `clicks:${key}`, {
      group: "anon_link",
      method: "GET",
    }))
  )
    throw new HTTPException(429, { message: "Too many requests. Try again shortly." });
  const db = drizzle(c.env.DB, { schema });
  const [row] = await db
    .select({ clicks: schema.anonLinks.clicks, expiresAt: schema.anonLinks.expiresAt })
    .from(schema.anonLinks)
    .where(eq(schema.anonLinks.claimToken, token))
    .limit(1);
  if (!row || row.expiresAt <= Date.now())
    throw new HTTPException(404, { message: "No such link" });
  return c.json({ clicks: row.clicks });
});

async function scoreAnonLink(
  env: Env,
  id: string,
  destination: string,
  spendLookup: SpendLookup,
): Promise<void> {
  // The caller's budget again: an over-budget or failed answer must not be asked at the site's cost.
  await scoreAndRecord(env, id, destination, "anon_links", spendLookup);
}

// Unknown, spent and expired tokens give the same answer, so no probe learns which tokens exist.
export async function claimAnonLink(
  env: Env,
  orgId: string,
  userId: string,
  claimToken: string,
): Promise<typeof schema.links.$inferSelect | null> {
  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(schema.anonLinks)
    .where(eq(schema.anonLinks.claimToken, claimToken));
  const anon = rows[0];
  if (!anon || anon.expiresAt <= Date.now()) return null;
  // The blocklist may have grown since the link was made.
  const { plan, limits } = await orgPlan(db, orgId);
  if (await isBlockedHost(db, anon.destination)) return null;
  const hold = await holdIfSuspicious(env, db, orgId, plan, anon.destination);
  const warning = hold ? null : await orgLinkWarning(db, orgId);

  const link = {
    id: uid(),
    orgId,
    domainId: null,
    slug: anon.slug,
    destination: anon.destination,
    title: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmTerm: "",
    utmContent: "",
    qrLogo: "",
    qrStyle: "",
    qrColor: "",
    qrCorner: "",
    qrBg: "",
    qrEyeColor: "",
    qrLogoSize: null,
    createdBy: userId,
    createdAt: Date.now(),
    riskScore: anon.riskScore,
    riskReasons: anon.riskReasons,
    riskCheckedAt: anon.riskCheckedAt,
    riskProvider: anon.riskProvider,
    suspendedAt: hold?.suspendedAt ?? null,
    suspendedBy: null,
    suspendReason: hold?.suspendReason ?? null,
    warnedAt: warning?.warnedAt ?? null,
    warnReason: warning?.warnReason ?? null,
    // Unknown: the anonymous row has no such column, so the weekly rescan (#341) takes it first.
    webRiskCheckedAt: null,
  };
  const address = {
    id: uid(),
    linkId: link.id,
    orgId,
    domainId: null,
    slug: anon.slug,
    kind: "primary" as const,
    reason: null,
    expiresAt: null,
    retiredAt: null,
    createdAt: Date.now(),
  };

  // Through the same plan-guarded insert as every link, so an org one under its limit
  // cannot take ten.
  if (!(await insertLinkWithinLimit(db, env, link, address, limits.links, anon.id))) return null;

  // Only once the link exists: deleting the anon row alongside a refused insert would take the slug down.
  await db.delete(schema.anonLinks).where(eq(schema.anonLinks.id, anon.id));

  // Republish without the expiry and with the org, through the sync (it reads the row):
  // a claim that landed held or warned must serve that page.
  await enqueueStorage(env, [syncLinkMsg(link.slug, null)]);

  // The copied verdict can be empty: a claim landing before the background scoring (waitUntil)
  // deletes the only row that task updates. Score here against the new row. A copied Web Risk
  // hit is checked again: it held nothing on the anonymous row, and claiming must not bypass it.
  if (anon.riskCheckedAt === null || anon.riskReasons?.includes("web_risk_"))
    await checkLinkDestination(env, link);
  return link;
}

export async function sweepExpiredAnonLinks(env: Env): Promise<number> {
  const db = drizzle(env.DB, { schema });
  const expired = await db
    .select({ id: schema.anonLinks.id, slug: schema.anonLinks.slug })
    .from(schema.anonLinks)
    .where(lt(schema.anonLinks.expiresAt, Date.now()))
    .limit(500);

  for (const row of expired) {
    // Sequential on purpose: up to 500 rows, each a KV and a D1 delete, would open a thousand
    // concurrent operations for a job nothing is waiting on.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await forgetAnonLink(env, row);
  }
  return expired.length;
}

/** Redirect key first, then the row, so a failure between leaves a row the next sweep retries. */
async function forgetAnonLink(env: Env, row: { id: string; slug: string }): Promise<void> {
  // Only if the key still belongs to this link. A claim landing between the select and here
  // republishes the slug under the org link's id; deleting that would leave a link in D1
  // that nothing resolves and no sweep retries.
  const published = await resolveSlug(env, row.slug, null);
  if (!published || published.linkId === row.id) await unpublishLink(env, row.slug, null);
  await env.DB.batch([
    env.DB.prepare("delete from anon_links where id = ?").bind(row.id),
    // An expired anonymous link's slug returns to allocateSharedSlug's random draw. Not while
    // an account's link holds it: a claim racing this sweep keeps the slug.
    env.DB.prepare(
      `delete from issued_slugs where slug = ?
         and not exists (select 1 from link_addresses where slug = ? and domain_id is null)`,
    ).bind(row.slug, row.slug),
  ]);
}
