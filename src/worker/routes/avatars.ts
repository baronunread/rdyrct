import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { AVATAR_PREFIX, avatarUrl, deleteUserAvatar } from "./../storage";
import { AVATAR_MAX_BYTES } from "@/shared/types";

// Mounted at /api/user/avatar. Upload, serving and removal are all keyed by
// the session user id, so no URL ever carries a user id and an unauthorized
// request gets an empty bucket (404).
export const avatarRoutes = new Hono<AppEnv>();

avatarRoutes.use(
  "*",
  bodyLimit({
    // Coarse ceiling so an oversized upload is rejected before the handler
    // runs; the exact limit is enforced below.
    maxSize: AVATAR_MAX_BYTES + 4096,
    onError: (c) => c.json({ message: "File too large" }, 413),
  }),
);

function requireUser(c: { var: AppEnv["Variables"] }) {
  const user = c.var.user;
  if (!user) throw new HTTPException(401, { message: "Not signed in" });
  return user;
}

/** JPEG (FF D8 FF), PNG (89 50 4E 47), or WebP (RIFF....WEBP). */
function sniff(body: ArrayBuffer): "image/jpeg" | "image/png" | "image/webp" | null {
  const b = new Uint8Array(body);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

avatarRoutes.post("/", async (c) => {
  const log = c.get("log");
  const user = requireUser(c);
  log.set({ route: "user-avatar", userId: user.id });

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) throw new HTTPException(400, { message: "Empty file" });
  if (body.byteLength > AVATAR_MAX_BYTES)
    throw new HTTPException(400, { message: "Picture too large (max 256 KB)" });
  const type = sniff(body);
  if (!type) throw new HTTPException(400, { message: "Picture must be a JPEG, PNG or WebP image" });

  await c.env.MEDIA.put(`${AVATAR_PREFIX}${user.id}`, body, {
    httpMetadata: { contentType: type },
  });
  const image = avatarUrl(Date.now());
  await c.var.db.update(schema.user).set({ image }).where(eq(schema.user.id, user.id));
  log.audit({
    action: "avatar.set",
    actor: { type: "user", id: user.id },
    target: { type: "user", id: user.id },
    outcome: "success",
  });
  return c.json({ image });
});

avatarRoutes.delete("/", async (c) => {
  const log = c.get("log");
  const user = requireUser(c);
  log.set({ route: "user-avatar", userId: user.id });

  await deleteUserAvatar(c.env, user.id);
  await c.var.db.update(schema.user).set({ image: null }).where(eq(schema.user.id, user.id));
  log.audit({
    action: "avatar.clear",
    actor: { type: "user", id: user.id },
    target: { type: "user", id: user.id },
    outcome: "success",
  });
  return c.body(null, 204);
});

avatarRoutes.get("/", async (c) => {
  const log = c.get("log");
  log.set({ route: "user-avatar" });
  const user = requireUser(c);
  log.set({ userId: user.id });

  const obj = await c.env.MEDIA.get(`${AVATAR_PREFIX}${user.id}`);
  log.set({ avatarFound: Boolean(obj) });
  if (!obj) throw new HTTPException(404, { message: "No avatar" });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  // The URL carries a `?v=` upload stamp, so a given version is immutable, but
  // a stale tab may still hold the old `?v=`; revalidate rather than pin.
  headers.set("cache-control", "private, max-age=0, must-revalidate");
  headers.set("etag", obj.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
});
