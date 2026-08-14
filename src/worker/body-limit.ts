import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { QR_LOGO_MAX_BYTES } from "@/shared/types";

// A generous ceiling for this API's JSON bodies — the largest legitimate
// payload (a link create/update with every optional field filled in, or a
// bulk invite) is a few KB — mainly a defense against an oversized or
// malformed request reaching a route handler at all before any other
// validation runs (see issue #19).
const DEFAULT_JSON_BODY_LIMIT = 32 * 1024;

// What anything that is not JSON gets. The QR logo upload is the only one,
// and it sets the same ceiling again on its own route; this exists because
// the org router's middleware runs first for every path under /orgs, which
// includes /orgs/:orgId/qr-logo. Holding a 512x512 WebP to a limit written
// for JSON is how a 6 KB PNG came back as "Request body too large".
const BINARY_BODY_LIMIT = QR_LOGO_MAX_BYTES + 4096;

const json = bodyLimit({
  maxSize: DEFAULT_JSON_BODY_LIMIT,
  onError: (c) => c.json({ message: "Request body too large" }, 413),
});

const binary = bodyLimit({
  maxSize: BINARY_BODY_LIMIT,
  onError: (c) => c.json({ message: "File too large" }, 413),
});

/**
 * The file-sized ceiling for an image upload, the JSON one for everything
 * else.
 *
 * Written round this way on purpose. Asking "is this JSON?" and giving the
 * larger limit to everything else means any header we fail to recognize gets
 * the loose ceiling: `Application/JSON` is valid, and a case-sensitive
 * `includes("json")` handed it 260 KB instead of 32. Asking "is this an
 * image?" fails the other way, which is the way to fail.
 *
 * The media type is compared the same way the upload route compares it: the
 * parameters dropped, the rest lowercased, since `image/webp; charset=x` and
 * `IMAGE/WEBP` are the same type.
 *
 * Neither ceiling is a substitute for a route's own validation: this only
 * keeps an oversized body from reaching a handler at all.
 */
export function jsonBodyLimit() {
  return (c: Context, next: Next) => {
    const type = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    return type.startsWith("image/") ? binary(c, next) : json(c, next);
  };
}
