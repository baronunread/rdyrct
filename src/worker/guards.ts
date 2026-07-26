import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) throw new HTTPException(401, { message: "Not signed in" });
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  // 404, not 403: non-admins shouldn't learn this surface exists at all.
  if (!c.var.user?.isAdmin) throw new HTTPException(404, { message: "Not found" });
  await next();
});
