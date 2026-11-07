import * as v from "valibot";
import { INVITABLE_ROLES, MARKETING_SOURCES, type JsonValue } from "../shared/types";
import { limitOverridesSchema } from "../shared/limits";
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
 * Parses a body whose fields are every one of them optional.
 *
 * `v.object` refuses anything that is not an object, so a body of `"foo"` or
 * `42` (valid JSON, just not the shape asked for) makes `v.parse` throw a
 * ValiError, which reaches the error handler as a 500. Such a caller named
 * none of the fields, which is what an empty body means: parse that instead,
 * and let the route answer with its own "you did not say X" branch.
 *
 * Only for all-optional schemas: one with a required field would throw on the
 * empty body too. Those want `parseBody` and its 400.
 */
export function parseOptionalBody<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  body: JsonValue,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, body);
  return result.success ? result.output : v.parse(schema, {});
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

/** An answer about the marketing lists: where it was given, and yes or no
 * for each list it covers. A list left out stays as it was; one is needed. */
export const marketingBodySchema = v.pipe(
  v.object({
    source: v.picklist(MARKETING_SOURCES, "source must be onboarding, prompt or settings"),
    news: v.optional(v.boolean("news must be true or false")),
    offers: v.optional(v.boolean("offers must be true or false")),
  }),
  v.check(
    (body) => body.news !== undefined || body.offers !== undefined,
    "Answer for news, offers or both",
  ),
);

/** The same for a flag, where anything that is not a boolean is not an answer. */
export const optionalFlag = v.optional(v.fallback(v.nullable(v.boolean()), null));

/**
 * An admin sets a user's custom limits, or clears them all with null. The
 * same schema the column is read with, but strict: a key it does not know is
 * a typo, and dropping it quietly would leave the admin thinking it took.
 */
export const limitsBodySchema = v.object({
  note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200, "note is too long"))),
  overrides: v.nullable(
    v.pipe(
      v.strictObject(limitOverridesSchema.entries),
      v.check((o) => !Array.isArray(o), "overrides must be an object"),
    ),
  ),
});

// A bulk-invite request pasting far more than this is almost certainly a
// mistake or abuse, not a real team roster; the org's member-cap check
// below still applies on top of this.
const MAX_INVITE_EMAILS = 50;

export const inviteBodySchema = v.object({
  role: v.optional(v.picklist(INVITABLE_ROLES), "member"),
  emails: v.optional(v.pipe(v.array(v.string()), v.maxLength(MAX_INVITE_EMAILS)), []),
  /** Mail addresses that already hold an open invite too. Without it only
   * new invites are mailed, so a repeated request cannot fill an inbox. */
  resend: v.optional(v.boolean(), false),
});
