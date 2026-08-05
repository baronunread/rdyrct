import { bodyLimit } from "hono/body-limit";

// A generous ceiling for this API's JSON bodies — the largest legitimate
// payload (a link create/update with every optional field filled in, or a
// bulk invite) is a few KB — mainly a defense against an oversized or
// malformed request reaching a route handler at all before any other
// validation runs (see issue #19). Binary uploads (the QR logo route) set
// their own, much larger limit instead of using this one.
const DEFAULT_JSON_BODY_LIMIT = 32 * 1024;

export function jsonBodyLimit() {
  return bodyLimit({
    maxSize: DEFAULT_JSON_BODY_LIMIT,
    onError: (c) => c.json({ message: "Request body too large" }, 413),
  });
}
