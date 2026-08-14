import * as v from "valibot";
import type { JsonValue } from "../shared/types";
import { HTTPException } from "hono/http-exception";

/**
 * Parses `body` against `schema`, throwing a 400 HTTPException with the
 * first issue's message on failure. Same library the client already uses
 * for form validation (src/app/lib/schemas.ts) — server-side schemas close
 * the gap where a caller that bypasses the client (a raw API request, a
 * malformed type) previously reached a route handler unchecked (see issue
 * #19).
 */
export function parseBody<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  body: JsonValue,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, body);
  if (!result.success) {
    const message = result.issues[0]?.message ?? "Invalid request";
    throw new HTTPException(400, { message });
  }
  return result.output;
}

/**
 * A text field the caller may leave out, send empty, or send as something
 * that is not text at all.
 *
 * All three mean "not given", and the route decides what that costs. Parsing
 * it here rather than checking the type at the point of use is the difference
 * between a route reading a `string` and a route reading whatever arrived.
 */
export const optionalText = v.optional(v.fallback(v.string(), ""), "");

/** The same for a flag, where anything that is not a boolean is not an answer. */
export const optionalFlag = v.optional(v.fallback(v.nullable(v.boolean()), null));

// A bulk-invite request pasting far more than this is almost certainly a
// mistake or abuse, not a real team roster; the org's member-cap check
// below still applies on top of this.
const MAX_INVITE_EMAILS = 50;

export const inviteBodySchema = v.object({
  role: v.optional(v.picklist(["admin", "member"]), "member"),
  emails: v.optional(v.pipe(v.array(v.string()), v.maxLength(MAX_INVITE_EMAILS)), []),
});
