import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, Env } from "./env";
import { withSession } from "./auth";
import { authRoutes } from "./routes/auth";
import { orgRoutes, inviteRoutes } from "./routes/orgs";
import { linkRoutes } from "./routes/links";
import { adminRoutes } from "./routes/admin";
import { resolveSlug } from "./kv";
import { now, deviceFromUA } from "./util";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ message: "Internal error" }, 500);
});

/* ---------------- API ---------------- */

const api = new Hono<AppEnv>();
api.use("*", withSession);
api.route("/auth", authRoutes);
api.route("/orgs", orgRoutes);
api.route("/orgs/:orgId/links", linkRoutes);
api.route("/invites", inviteRoutes);
api.route("/admin", adminRoutes);
app.route("/api", api);

/* ---------------- redirect hot path ---------------- */

// KV lookup only on request; click recording happens after the redirect
// is already on its way (waitUntil), so redirects stay fast.
app.get("/:slug", async (c, next) => {
  const slug = c.req.param("slug");
  const hit = await resolveSlug(c.env, slug);
  if (!hit) return next(); // fall through to the SPA (404 page)

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const db = drizzle(c.env.DB, { schema });
        await db.insert(schema.clicks).values({
          linkId: hit.linkId,
          orgId: hit.orgId,
          ts: now(),
          country: (c.req.raw.cf?.country as string) ?? "",
          referrer: c.req.header("referer") ?? "",
          device: deviceFromUA(c.req.header("user-agent") ?? ""),
        });
      } catch (e) {
        console.error("click insert failed", e);
      }
    })(),
  );

  return c.redirect(hit.url, 302);
});

/* ---------------- SPA fallback ---------------- */

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
