import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, SessionUser } from "./env";
import { getAuth } from "./better-auth";

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
      plan: (session.user.plan ?? "free") as "free" | "hobby" | "pro",
      polarSubscriptionCancelAtPeriodEnd: session.user.polarSubscriptionCancelAtPeriodEnd ?? false,
      polarSubscriptionCurrentPeriodEnd:
        (session.user.polarSubscriptionCurrentPeriodEnd as number | null) ?? null,
    } satisfies SessionUser);
  }
  await next();
});
