import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { AVATAR_PREFIX } from "./../storage";

// Mounted at /api/user/avatar. Serves the signed-in user's own avatar bytes
// from R2. The key is the session user id, so no URL ever carries a user id
// and an unauthorized request gets an empty bucket (404).
export const avatarRoutes = new Hono<AppEnv>();

avatarRoutes.get("/", async (c) => {
  const log = c.get("log");
  log.set({ route: "user-avatar" });
  const user = c.var.user;
  if (!user) throw new HTTPException(401, { message: "Not signed in" });
  log.set({ userId: user.id });

  const obj = await c.env.MEDIA.get(`${AVATAR_PREFIX}${user.id}`);
  log.set({ avatarFound: Boolean(obj) });
  if (!obj) throw new HTTPException(404, { message: "No avatar" });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
});
