import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { QR_LOGO_MAX_BYTES } from "@/shared/types";

// Mainly a defense against an oversized or malformed request reaching a handler (#19). The largest legitimate payload is a few KB.
const DEFAULT_JSON_BODY_LIMIT = 32 * 1024;

// The QR logo upload is the only non-JSON body, and the org router middleware runs first for /orgs/:orgId/qr-logo.
// A JSON limit once made a 6 KB PNG come back as Request body too large.
const BINARY_BODY_LIMIT = QR_LOGO_MAX_BYTES + 4096;

const json = bodyLimit({
  maxSize: DEFAULT_JSON_BODY_LIMIT,
  onError: (c) => c.json({ message: "Request body too large" }, 413),
});

const binary = bodyLimit({
  maxSize: BINARY_BODY_LIMIT,
  onError: (c) => c.json({ message: "File too large" }, 413),
});

// Ask is this an image, not is this JSON: an unrecognized header must not get the loose ceiling (Application/JSON is valid, and a case-sensitive
// includes(json) handed it 260 KB instead of 32). The media type is compared as the upload route does: parameters dropped, lowercased.
export function jsonBodyLimit() {
  return (c: Context, next: Next) => {
    const type = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    return type.startsWith("image/") ? binary(c, next) : json(c, next);
  };
}
