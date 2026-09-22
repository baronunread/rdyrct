import { createMiddleware } from "hono/factory";
import { orgPlanOf } from "../shared/types";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { jwtVerify, createLocalJWKSet, type JSONWebKeySet } from "jose";
import * as schema from "./db/schema";
import type { AppEnv, DB, Env, SessionUser } from "./env";
import { getAuth } from "./better-auth";
import { API_KEY_PREFIX, hashApiKey } from "./api-keys";
import { mcpResource } from "./mcp-oauth";

/**
 * The subscription period end as stored: an integer column, or nothing.
 *
 * The null check has to come first. `Number(null)` is 0, not NaN, and a user
 * with no subscription reads the column as null, so without it every free
 * account would report a period ending on 1 January 1970.
 */
function periodEndOf(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = Number(value);
  return Number.isFinite(ms) ? ms : null;
}

/** A `user` row (as Drizzle reads it back, real Date columns) to the shape
 * every auth path ends up with. Shared by the API-key and OAuth-token
 * branches below; the cookie branch reads a differently-shaped object
 * (better-auth's own loosely-typed session.user) and keeps its own mapping. */
function sessionUserOfRow(row: typeof schema.user.$inferSelect): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: row.isAdmin,
    emailVerified: row.emailVerified,
    plan: orgPlanOf(row.plan),
    polarSubscriptionCancelAtPeriodEnd: row.polarSubscriptionCancelAtPeriodEnd ?? false,
    polarSubscriptionCurrentPeriodEnd: row.polarSubscriptionCurrentPeriodEnd?.getTime() ?? null,
    image: row.image ?? null,
  };
}

/** A bearer key's owner, resolved to the same shape a session cookie
 * produces, plus the key row's id so the caller can bump its last-used mark. */
async function userFromApiKey(
  db: DB,
  authorization: string | undefined,
): Promise<{ keyId: string; user: SessionUser } | null> {
  const raw = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!raw || !raw.startsWith(API_KEY_PREFIX)) return null;

  const hash = await hashApiKey(raw);
  const rows = await db
    .select({ keyId: schema.apiKeys.id, user: schema.user })
    .from(schema.apiKeys)
    .innerJoin(schema.user, eq(schema.apiKeys.userId, schema.user.id))
    .where(and(eq(schema.apiKeys.keyHash, hash), isNull(schema.apiKeys.revokedAt)));
  const row = rows[0];
  // A banned account's session is refused at the cookie layer (better-auth's
  // databaseHooks.session.create.before); a bearer key skips that hook
  // entirely, so the same refusal has to happen here.
  if (!row || row.user.banned) return null;

  return { keyId: row.keyId, user: sessionUserOfRow(row.user) };
}

/**
 * An MCP OAuth access token's owner (#139 follow-up), verified the same way
 * `requireMcpAuth` would: signature against the jwt plugin's own signing
 * keys (fetched in-process, no network hop), issuer pinned to this app's
 * auth base URL, audience pinned to the MCP resource every token here is
 * bound to. Bearer-only, deliberately: DPoP sender-constraint proofs are
 * real hardening `requireMcpAuth` also offers, but they'd have to be
 * threaded through this same forwarded-header path with no request object
 * to attach a proof to, and a plain bearer token is the same trust level our
 * API keys already carry.
 *
 * A revoked grant's already-issued access token stays valid until its own
 * (short) expiry: this checks the JWT alone, not the row oauth-provider
 * would delete on revoke. Revoking a connected app stops it from ever
 * minting another one (see api-keys.tsx's "Connected apps"), which is the
 * same window every bearer credential (a cookie, an API key) already has.
 */
async function userFromOAuthToken(
  env: Env,
  db: DB,
  authorization: string | undefined,
): Promise<SessionUser | null> {
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
    return sessionUserOfRow(row);
  } catch {
    // Not a JWT, an expired one, a bad signature, or the wrong audience: all
    // the same "not authenticated this way" to the caller.
    return null;
  }
}

/**
 * Attaches db + user to context, from the BetterAuth session cookie or, for
 * a caller with no browser session (a remote MCP client, #139), either a
 * scoped API key (#131) or an MCP OAuth access token (#139 follow-up) as
 * `Authorization: Bearer …`. Every path ends up the same SessionUser shape,
 * so every existing :orgId route (requireOrgRole) authorizes a key or a
 * token exactly as it would a browser.
 *
 * `oauthTokenPath`, when given, is the one request path an OAuth token may
 * authenticate: the token's own `aud` claim already names `/api/mcp` (see
 * mcpResource), so this enforces the boundary the token already declares
 * about itself, rather than letting a grant for "confirm your identity"
 * also authorize every other /api/orgs/* route the way a full session or
 * API key does (#242). The public `api` app passes it; mcp.ts's `internal`
 * app (re-dispatching a tool call to the real route handler, in-process,
 * under a path with no /api prefix at all) omits it, since that app is
 * never reachable by a real inbound request — only by mcp.ts's own already-
 * authenticated dispatch() — and restricting it there would break every
 * OAuth-authenticated tool call.
 */
export function withSession(opts: { oauthTokenPath?: string } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const db = drizzle(c.env.DB, { schema });
    c.set("db", db);
    c.set("user", null);

    const session = await getAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });
    if (session) {
      c.set("user", {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        isAdmin: session.user.isAdmin ?? false,
        emailVerified: session.user.emailVerified,
        plan: orgPlanOf(session.user.plan),
        polarSubscriptionCancelAtPeriodEnd:
          session.user.polarSubscriptionCancelAtPeriodEnd ?? false,
        // better-auth types its extra user fields loosely; the column is an
        // integer, and periodEndOf keeps "no subscription" as null.
        polarSubscriptionCurrentPeriodEnd: periodEndOf(
          session.user.polarSubscriptionCurrentPeriodEnd,
        ),
        image: session.user.image ?? null,
      } satisfies SessionUser);
    } else {
      const authorization = c.req.header("authorization");
      const viaKey = await userFromApiKey(db, authorization);
      if (viaKey) {
        c.set("user", viaKey.user);
        c.executionCtx.waitUntil(
          db
            .update(schema.apiKeys)
            .set({ lastUsedAt: Date.now() })
            .where(eq(schema.apiKeys.id, viaKey.keyId)),
        );
      } else if (!opts.oauthTokenPath || c.req.path === opts.oauthTokenPath) {
        const viaOAuth = await userFromOAuthToken(c.env, db, authorization);
        if (viaOAuth) c.set("user", viaOAuth);
      }
    }
    await next();
  });
}
