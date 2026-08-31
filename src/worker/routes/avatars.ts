import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { AVATAR_PREFIX, avatarUrl, deleteUserAvatar } from "./../storage";
import { AVATAR_MAX_BYTES, AVATAR_MAX_DIMENSION } from "@/shared/types";

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

type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** JPEG (FF D8 FF), PNG (89 50 4E 47), or WebP (RIFF....WEBP). */
function sniff(b: Uint8Array): ImageType | null {
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

type Size = [number, number] | null;

/** PNG: W, H (BE uint32) right after the 8-byte sig, 4-byte length and "IHDR". */
function pngSize(b: Uint8Array, dv: DataView): Size {
  return b.length >= 24 ? [dv.getUint32(16), dv.getUint32(20)] : null;
}

/** JPEG: walk the marker segments to the first SOF, which carries H then W (BE). */
function jpegSize(b: Uint8Array, dv: DataView): Size {
  for (let i = 2; i + 9 < b.length && b[i] === 0xff; i += 2 + dv.getUint16(i + 2)) {
    const m = b[i + 1];
    const isSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (isSof) return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
  }
  return null;
}

/** WebP: the fourcc after "WEBP" picks one of three size encodings. */
function webpSize(b: Uint8Array, dv: DataView): Size {
  if (b.length < 30) return null;
  const cc = String.fromCharCode(...b.slice(12, 16));
  if (cc === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
    return [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff];
  if (cc === "VP8L" && b[20] === 0x2f) {
    const bits = dv.getUint32(21, true);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  if (cc === "VP8X") {
    const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
    return [1 + u24(24), 1 + u24(27)];
  }
  return null;
}

/** Pixel dimensions from the header, without decoding. Null when unreadable. */
function dimensions(b: Uint8Array, type: ImageType): Size {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (type === "image/png") return pngSize(b, dv);
  if (type === "image/jpeg") return jpegSize(b, dv);
  return webpSize(b, dv);
}

avatarRoutes.post("/", async (c) => {
  const log = c.get("log");
  const user = requireUser(c);
  log.set({ route: "user-avatar", userId: user.id });

  const body = await c.req.arrayBuffer();
  const bytes = new Uint8Array(body);
  if (bytes.byteLength === 0) throw new HTTPException(400, { message: "Empty file" });
  if (bytes.byteLength > AVATAR_MAX_BYTES)
    throw new HTTPException(400, { message: "Picture too large (max 256 KB)" });
  const type = sniff(bytes);
  if (!type) throw new HTTPException(400, { message: "Picture must be a JPEG, PNG or WebP image" });
  const size = dimensions(bytes, type);
  if (!size) throw new HTTPException(400, { message: "Could not read this image" });
  if (size[0] > AVATAR_MAX_DIMENSION || size[1] > AVATAR_MAX_DIMENSION)
    throw new HTTPException(400, {
      message: `Picture must be at most ${AVATAR_MAX_DIMENSION}px on a side`,
    });

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

  // Served on every page load (sidebar, org switcher, footer). R2 throttles
  // simultaneous reads of one object (error 10058) and has transient blips
  // (10001); neither is worth a 500 or a Sentry issue, so degrade to a 503
  // the client just retries.
  let obj: R2ObjectBody | null;
  try {
    obj = await c.env.MEDIA.get(`${AVATAR_PREFIX}${user.id}`);
  } catch (err) {
    log.set({ avatarReadError: String(err) });
    return c.body(null, 503, { "Retry-After": "2", "Cache-Control": "no-store" });
  }
  log.set({ avatarFound: Boolean(obj) });
  if (!obj) throw new HTTPException(404, { message: "No avatar" });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  // The URL carries a `?v=` upload stamp, so each version is immutable and a
  // new upload is a new URL: let the browser hold it a few minutes instead of
  // revalidating on every navigation. A tab that never refreshes shows a
  // picture at most 5 minutes stale.
  headers.set("cache-control", "private, max-age=300");
  headers.set("etag", obj.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
});
