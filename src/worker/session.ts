import { createMiddleware } from "hono/factory";
import { orgPlanOf } from "../shared/types";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "./db/schema";
import type { AppEnv, DB, SessionUser } from "./env";
import { getAuth } from "./better-auth";
import { API_KEY_PREFIX, hashApiKey } from "./api-keys";

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

  return {
    keyId: row.keyId,
    user: {
      id: row.user.id,
      email: row.user.email,
      name: row.user.name,
      isAdmin: row.user.isAdmin,
      emailVerified: row.user.emailVerified,
      plan: orgPlanOf(row.user.plan),
      polarSubscriptionCancelAtPeriodEnd: row.user.polarSubscriptionCancelAtPeriodEnd ?? false,
      // The column reads back as a Date (mode: "timestamp_ms"), unlike
      // better-auth's loosely-typed session field periodEndOf was written for.
      polarSubscriptionCurrentPeriodEnd:
        row.user.polarSubscriptionCurrentPeriodEnd?.getTime() ?? null,
      image: row.user.image ?? null,
    },
  };
}

/** Attaches db + user to context, from the BetterAuth session cookie or, for
 * a caller with no browser session (a remote MCP client, #139), a scoped API
 * key (#131) as `Authorization: Bearer rdyrct_live_…`. Either way `user`
 * ends up the same shape, so every existing :orgId route (requireOrgRole)
 * authorizes a key exactly as it would a browser. */
export const withSession = createMiddleware<AppEnv>(async (c, next) => {
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
      polarSubscriptionCancelAtPeriodEnd: session.user.polarSubscriptionCancelAtPeriodEnd ?? false,
      // better-auth types its extra user fields loosely; the column is an
      // integer, and periodEndOf keeps "no subscription" as null.
      polarSubscriptionCurrentPeriodEnd: periodEndOf(
        session.user.polarSubscriptionCurrentPeriodEnd,
      ),
      image: session.user.image ?? null,
    } satisfies SessionUser);
  } else {
    const viaKey = await userFromApiKey(db, c.req.header("authorization"));
    if (viaKey) {
      c.set("user", viaKey.user);
      c.executionCtx.waitUntil(
        db
          .update(schema.apiKeys)
          .set({ lastUsedAt: Date.now() })
          .where(eq(schema.apiKeys.id, viaKey.keyId)),
      );
    }
  }
  await next();
});
