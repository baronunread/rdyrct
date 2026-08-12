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
 * The JSON ceiling for JSON, a file-sized one for everything else.
 *
 * Neither is a substitute for a route's own validation: this only keeps an
 * oversized body from reaching a handler at all.
 */
export function jsonBodyLimit() {
  return (c: Context, next: Next) => {
    const type = c.req.header("content-type") ?? "";
    const isJson = type === "" || type.includes("json");
    return isJson ? json(c, next) : binary(c, next);
  };
}
