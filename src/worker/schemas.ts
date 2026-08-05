import * as v from "valibot";
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
  body: unknown,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, body);
  if (!result.success) {
    const message = result.issues[0]?.message ?? "Invalid request";
    throw new HTTPException(400, { message });
  }
  return result.output;
}

// A bulk-invite request pasting far more than this is almost certainly a
// mistake or abuse, not a real team roster; the org's member-cap check
// below still applies on top of this.
const MAX_INVITE_EMAILS = 50;

export const inviteBodySchema = v.object({
  role: v.optional(v.picklist(["admin", "member"]), "member"),
  emails: v.optional(v.pipe(v.array(v.string()), v.maxLength(MAX_INVITE_EMAILS)), []),
});
