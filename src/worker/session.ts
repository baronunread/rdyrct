import { createMiddleware } from "hono/factory";
import { orgPlanOf } from "../shared/types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, SessionUser } from "./env";
import { getAuth } from "./better-auth";

/** The subscription period end as stored: an integer column, or nothing. */
function periodEndOf(value: unknown): number | null {
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
      // integer, and Number() turns an absent one into NaN, not a date.
      polarSubscriptionCurrentPeriodEnd: periodEndOf(
        session.user.polarSubscriptionCurrentPeriodEnd,
      ),
    } satisfies SessionUser);
  }
  await next();
});
