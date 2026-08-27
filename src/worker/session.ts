import { createMiddleware } from "hono/factory";
import { orgPlanOf } from "../shared/types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, SessionUser } from "./env";
import { getAuth } from "./better-auth";

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

/** Attaches db + user (from the BetterAuth session, if any) to context. */
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
  }
  await next();
});
