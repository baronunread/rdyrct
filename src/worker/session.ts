import { createMiddleware } from "hono/factory";
import { configureBilling, planNow } from "./plan";
import { orgPlanOf } from "../shared/types";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { jwtVerify, createLocalJWKSet, type JSONWebKeySet } from "jose";
import * as schema from "./db/schema";
import type { AppEnv, DB, Env, SessionUser } from "./env";
import { getAuth } from "./better-auth";
import { API_KEY_PREFIX, hashApiKey } from "./api-keys";
import { mcpResource } from "./mcp-oauth";

// Check null first: Number(null) is 0, so every free account would report a period ending in 1970.
function periodEndOf(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = Number(value);
  return Number.isFinite(ms) ? ms : null;
}

function intervalOf(value: string | null | undefined): "month" | "year" | null {
  return value === "month" || value === "year" ? value : null;
}

function sessionUserOfRow(row: typeof schema.user.$inferSelect): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: row.isAdmin,
    emailVerified: row.emailVerified,
    plan: planNow(orgPlanOf(row.plan)),
    polarSubscriptionCancelAtPeriodEnd: row.polarSubscriptionCancelAtPeriodEnd ?? false,
    polarSubscriptionCurrentPeriodEnd: row.polarSubscriptionCurrentPeriodEnd?.getTime() ?? null,
    polarSubscriptionInterval: intervalOf(row.polarSubscriptionInterval),
    image: row.image ?? null,
  };
}

interface Caller {
  user: SessionUser;
  lastSeenAt: number | null;
}

async function userFromApiKey(
  db: DB,
  authorization: string | undefined,
): Promise<(Caller & { keyId: string; keyLastUsedAt: number | null }) | null> {
  const raw = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!raw || !raw.startsWith(API_KEY_PREFIX)) return null;

  const hash = await hashApiKey(raw);
  const rows = await db
    .select({
      keyId: schema.apiKeys.id,
      keyLastUsedAt: schema.apiKeys.lastUsedAt,
      user: schema.user,
    })
    .from(schema.apiKeys)
    .innerJoin(schema.user, eq(schema.apiKeys.userId, schema.user.id))
    .where(and(eq(schema.apiKeys.keyHash, hash), isNull(schema.apiKeys.revokedAt)));
  const row = rows[0];
  // A bearer key skips better-auth databaseHooks.session.create.before, which refuses a banned account at the cookie layer, so refuse here too.
  if (!row || row.user.banned) return null;

  return {
    keyId: row.keyId,
    keyLastUsedAt: row.keyLastUsedAt,
    user: sessionUserOfRow(row.user),
    lastSeenAt: row.user.lastSeenAt,
  };
}

// Bearer-only: DPoP proofs would need a request object to attach to on this forwarded path, and a plain bearer is the trust level API keys carry.
// A revoked grant access token stays valid until its short expiry: this checks the JWT alone. Revoking stops it minting another.
async function userFromOAuthToken(
  env: Env,
  db: DB,
  authorization: string | undefined,
): Promise<Caller | null> {
  const raw = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!raw || raw.startsWith(API_KEY_PREFIX)) return null;

  try {
    // SAFETY: getJwks() is the jwt plugin's own endpoint, serving exactly
    // the public-key JWKS shape jose's local key set expects.
    const jwks = (await getAuth(env).api.getJwks()) as JSONWebKeySet;
    const { payload } = await jwtVerify(raw, createLocalJWKSet(jwks), {
      issuer: `${env.APP_URL}/api/auth`,
      audience: mcpResource(env),
    });
    if (!payload.sub) return null;

    const rows = await db.select().from(schema.user).where(eq(schema.user.id, payload.sub));
    const row = rows[0];
    if (!row || row.banned) return null;
    return { user: sessionUserOfRow(row), lastSeenAt: row.lastSeenAt };
  } catch {
    return null;
  }
}

type AuthSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>
>;

function sessionUserOf(user: AuthSession["user"]): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin ?? false,
    emailVerified: user.emailVerified,
    plan: planNow(orgPlanOf(user.plan)),
    polarSubscriptionCancelAtPeriodEnd: user.polarSubscriptionCancelAtPeriodEnd ?? false,
    // better-auth types extra user fields loosely; periodEndOf keeps no subscription as null.
    polarSubscriptionCurrentPeriodEnd: periodEndOf(user.polarSubscriptionCurrentPeriodEnd),
    polarSubscriptionInterval: intervalOf(user.polarSubscriptionInterval),
    image: user.image ?? null,
  } satisfies SessionUser;
}

const SEEN_EVERY_MS = 60 * 60 * 1000;

// The keys page shows a relative date, so five minutes of lag is the most it shows, for one write per five minutes instead of one per call (#489).
const KEY_USED_EVERY_MS = 5 * 60 * 1000;

const due = (at: number | null | undefined, every: number, now: number) =>
  at == null || at < now - every;

// Two requests arriving together both see an old mark, and only the first changes the row (#489).
function markSeen(db: DB, userId: string, lastSeenAt: number | null | undefined) {
  const now = Date.now();
  if (!due(lastSeenAt, SEEN_EVERY_MS, now)) return null;
  return db
    .update(schema.user)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(schema.user.id, userId),
        or(isNull(schema.user.lastSeenAt), lt(schema.user.lastSeenAt, now - SEEN_EVERY_MS)),
      ),
    );
}

// oauthTokenPath is the one path an OAuth token may authenticate: its aud names /api/mcp, so a grant for confirming identity cannot authorize
// every other /api/orgs/* route (#242). mcp.ts internal app omits it: it re-dispatches in-process under a path with no /api prefix,
// never reachable by an inbound request.
export function withSession(opts: { oauthTokenPath?: string } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    configureBilling(c.env);
    const db = drizzle(c.env.DB, { schema });
    c.set("db", db);
    c.set("user", null);

    const session = await getAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });
    let caller: Caller | null = null;
    if (session) {
      caller = { user: sessionUserOf(session.user), lastSeenAt: session.user.lastSeenAt ?? null };
    } else {
      const authorization = c.req.header("authorization");
      const viaKey = await userFromApiKey(db, authorization);
      if (viaKey) {
        caller = viaKey;
        const now = Date.now();
        if (due(viaKey.keyLastUsedAt, KEY_USED_EVERY_MS, now))
          c.executionCtx.waitUntil(
            db
              .update(schema.apiKeys)
              .set({ lastUsedAt: now })
              .where(eq(schema.apiKeys.id, viaKey.keyId)),
          );
      } else if (!opts.oauthTokenPath || c.req.path === opts.oauthTokenPath) {
        caller = await userFromOAuthToken(c.env, db, authorization);
      }
    }
    if (caller) {
      const { user } = caller;
      c.set("user", user);
      const seen = markSeen(db, user.id, caller.lastSeenAt);
      if (seen) c.executionCtx.waitUntil(seen);
      // Ids only, never the email.
      c.get("log")?.set({ user: { id: user.id, plan: user.plan, admin: user.isAdmin } });
    }
    await next();
  });
}
