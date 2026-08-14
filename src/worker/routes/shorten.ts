/**
 * The anonymous shortener on the landing page (Direction A of #96).
 *
 * A visitor with no account can paste a URL and get a working short link
 * back. It lasts 24 hours, and signing up keeps it: the claim moves it into
 * the new org as a real link, so the first thing a new account contains is
 * the visitor's own work rather than an empty dashboard. That is the other
 * half of the activation cliff in #65.
 *
 * This is an unauthenticated write path, which is the most abused endpoint
 * shape there is, so it does not ship alone:
 *  - Cap proof-of-work (#98) on the "anon-link" scope, so each attempt costs
 *    the caller real CPU.
 *  - Its own rate-limit namespace, not the one guarding auth: a flood here
 *    must not lock anybody out of signing in.
 *  - Destination scoring (#68) after the response, same as a real link.
 *  - Random slugs only, and a 24-hour life, so the shared namespace cannot
 *    be squatted or farmed.
 */
import { Hono } from "hono";
import type { JsonValue } from "../../shared/types";
import { optionalText } from "../schemas";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, Env } from "../env";
import { jsonBodyLimit } from "../body-limit";
import { publishLink, resolveSlug, unpublishLink } from "../kv";
import { scoreAndRecord } from "../risk";
import { spendToken } from "../cap";
import { CAP_FAILED_CODE } from "@/shared/types";
import { isValidHttpUrl, normalizeUrl, randomSlug, uid } from "../util";
import { publicClientKey, rateLimitAllows } from "../rate-limit";
import { insertLinkWithinLimit, orgPlan } from "../plan";

/** How long an unclaimed link keeps working. */
const ANON_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** What the anonymous shortener reads off its request body. */
const shortenBodySchema = v.object({
  destination: optionalText,
  capToken: optionalText,
});

export const shortenRoutes = new Hono<AppEnv>();
shortenRoutes.use("*", jsonBodyLimit());

shortenRoutes.post("/", async (c) => {
  // Its own namespace, not the auth one: a flood here must not lock anybody
  // out of signing in. Keyed by the same HMAC the auth limiter uses, so no
  // raw address reaches storage or logs.
  const key = await publicClientKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
  if (!(await rateLimitAllows(c.env.RL_ANON_LINK, key, { group: "anon_link", method: "POST" })))
    throw new HTTPException(429, {
      message: "Too many links from here. Try again shortly, or sign up.",
    });

  const body = v.parse(shortenBodySchema, await c.req.json<JsonValue>().catch(() => ({})));

  if (!(await spendToken(c.env, "anon-link", body.capToken)))
    // Coded so the browser can solve again and retry once, rather than
    // showing somebody an error they cannot act on.
    throw new HTTPException(400, {
      message: "Could not verify you are human. Reload the page and try again.",
      cause: { code: CAP_FAILED_CODE },
    });

  if (!body.destination.trim())
    throw new HTTPException(400, { message: "Paste a link to shorten" });

  const destination = normalizeUrl(body.destination.trim());
  if (!isValidHttpUrl(destination))
    throw new HTTPException(400, { message: "That does not look like a web address" });

  const db = drizzle(c.env.DB, { schema });
  const now = Date.now();
  const expiresAt = now + ANON_LINK_TTL_MS;
  const row = {
    id: uid(),
    slug: await allocateSlug(c.env),
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

  // Published with the row's own id in both slots and no org. The redirect
  // path reads this like any other key; `orgId: ""` is what tells it not to
  // record a click, since there is no link and no org for one to belong to.
  await publishLink(
    c.env,
    {
      id: row.id,
      addressId: row.id,
      orgId: "",
      slug: row.slug,
      destination,
      expiresAt,
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
    },
    null,
  );

  c.executionCtx.waitUntil(scoreAnonLink(c.env, row.id, destination));

  return c.json(
    {
      slug: row.slug,
      url: `${c.env.APP_URL}/${row.slug}`,
      claimToken: row.claimToken,
      expiresAt,
    },
    201,
  );
});

/**
 * Scores an anonymous destination, reusing the link scorer's write shape.
 *
 * Separate from `scoreAndRecord` only because the table differs; the verdict
 * and every failure rule are the same, which is why the score itself comes
 * from the same function.
 */
async function scoreAnonLink(env: Env, id: string, destination: string): Promise<void> {
  await scoreAndRecord(env.DB, id, destination, "anon_links");
}

/** A random slug that is not already taken, in either table. */
async function allocateSlug(env: Env): Promise<string> {
  const db = drizzle(env.DB, { schema });
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug();
    if (!(await slugTaken(env, db, slug))) return slug;
  }
  throw new HTTPException(503, { message: "Could not allocate a link. Try again." });
}

/**
 * Whether anything already answers on this slug of the shared domain.
 *
 * Both stores, because neither alone is enough. KV is the redirect
 * namespace, so one read covers every published address whichever table
 * owns it. But an organization link is written to D1 first and published
 * after, and a slug taken inside that window is invisible to KV: checking
 * KV alone let an anonymous link be minted on it and then overwrite the
 * redirect somebody else's link already owned.
 *
 * Still not a lock. Two writers can pass this at the same instant, and only
 * the unique index on `anon_links.slug` actually decides between two
 * anonymous inserts. What this closes is the window that was wide enough to
 * matter, at the cost of one indexed lookup on a path that already does
 * several.
 */
export async function slugTaken(
  env: Env,
  db: ReturnType<typeof drizzle>,
  slug: string,
): Promise<boolean> {
  if (await env.LINKS.get(`slug:${slug}`)) return true;

  const [address] = await db
    .select({ id: schema.linkAddresses.id })
    .from(schema.linkAddresses)
    .where(
      and(
        eq(schema.linkAddresses.slug, slug),
        // The shared domain only: the same slug on somebody's custom domain
        // is a different key and a different link.
        isNull(schema.linkAddresses.domainId),
        isNull(schema.linkAddresses.retiredAt),
      ),
    )
    .limit(1);
  if (address) return true;

  const [anon] = await db
    .select({ id: schema.anonLinks.id })
    .from(schema.anonLinks)
    .where(eq(schema.anonLinks.slug, slug))
    .limit(1);
  return !!anon;
}

/**
 * Hands an anonymous link to the org that just claimed it.
 *
 * Returns the created link row, or null when the token is unknown, already
 * spent, or expired. All three are the same answer on purpose: the caller
 * gets "that link is gone", and no probe learns which tokens exist.
 */
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
    // The verdict travels with the link: it was scored on the same
    // destination, so re-scanning it here would be work for its own sake.
    riskScore: anon.riskScore,
    riskReasons: anon.riskReasons,
    riskCheckedAt: anon.riskCheckedAt,
    riskProvider: anon.riskProvider,
    // New links are never born suspended; only an admin sets this (#67).
    suspendedAt: null,
    suspendedBy: null,
    suspendReason: null,
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

  // Through the same cap-guarded insert every other link goes through, not a
  // raw one: claiming is still creating a link in somebody's organization,
  // and an org one under its limit must not be able to take ten.
  const { limits } = await orgPlan(db, orgId);
  if (!(await insertLinkWithinLimit(db, env, link, address, limits.links))) return null;

  // Only once the link exists: an anon row deleted alongside a refused
  // insert would take the slug down with it.
  await db.delete(schema.anonLinks).where(eq(schema.anonLinks.id, anon.id));

  // Republish without the expiry, and now carrying the org, so clicks start
  // being recorded against the link its owner can see.
  await publishLink(env, { ...link, addressId: address.id, expiresAt: null }, null);

  // The verdict copied above can be empty. Scoring an anonymous link runs
  // after its response, in waitUntil, and a claim landing first copies four
  // nulls and then deletes the only row that background task knows how to
  // update: the link stayed unscored for good, on the one table moderation
  // reads. Scored here instead, against the row that now exists.
  if (anon.riskCheckedAt === null) await scoreAndRecord(env.DB, link.id, link.destination);
  return link;
}

/** Daily: drop anonymous links nobody claimed, and their KV keys. */
export async function sweepExpiredAnonLinks(env: Env): Promise<number> {
  const db = drizzle(env.DB, { schema });
  const expired = await db
    .select({ id: schema.anonLinks.id, slug: schema.anonLinks.slug })
    .from(schema.anonLinks)
    .where(lt(schema.anonLinks.expiresAt, Date.now()))
    .limit(500);

  for (const row of expired) {
    // Sequential on purpose: a daily sweep of up to 500 rows, each doing a
    // KV delete and a D1 delete. Running them at once would open a thousand
    // concurrent operations against two services to finish a job nothing is
    // waiting on.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await forgetAnonLink(env, row);
  }
  return expired.length;
}

/** Drops one anonymous link: its redirect key first, then its row. In that
 * order, so a failure between the two leaves a row the next sweep retries
 * rather than a slug that still resolves with nothing behind it. */
async function forgetAnonLink(env: Env, row: { id: string; slug: string }): Promise<void> {
  // Only if the key still belongs to this anonymous link. A claim landing
  // between the sweep's select and here republishes the same slug under the
  // organization link's id, and deleting that would leave somebody's link
  // in D1 with nothing resolving it: the one state neither side can repair,
  // because the row that would tell the next sweep to retry is gone too.
  const published = await resolveSlug(env, row.slug, null);
  if (!published || published.linkId === row.id) await unpublishLink(env, row.slug, null);
  await drizzle(env.DB, { schema }).delete(schema.anonLinks).where(eq(schema.anonLinks.id, row.id));
}
