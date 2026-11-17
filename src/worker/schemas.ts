import * as v from "valibot";
import { INVITABLE_ROLES, MARKETING_SOURCES, type JsonValue } from "../shared/types";
import { limitOverridesSchema } from "../shared/limits";
import { HTTPException } from "hono/http-exception";

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
 * `v.object` refuses a non-object body (`"foo"`, `42`), which would reach the
 * error handler as a 500. Treat it as an empty body. Only for all-optional
 * schemas: a required field wants `parseBody` and its 400.
 */
export function parseOptionalBody<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  body: JsonValue,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, body);
  return result.success ? result.output : v.parse(schema, {});
}

export const optionalText = v.optional(v.fallback(v.string(), ""), "");

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

export const optionalFlag = v.optional(v.fallback(v.nullable(v.boolean()), null));

/** Strict: a key it does not know is a typo, and dropping it would look like it took. */
export const limitsBodySchema = v.object({
  note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200, "note is too long"))),
  overrides: v.nullable(
    v.pipe(
      v.strictObject(limitOverridesSchema.entries),
      v.check((o) => !Array.isArray(o), "overrides must be an object"),
    ),
  ),
});

// More than this is almost certainly a mistake or abuse; the member-cap check still applies.
const MAX_INVITE_EMAILS = 50;

export const inviteBodySchema = v.object({
  role: v.optional(v.picklist(INVITABLE_ROLES), "member"),
  emails: v.optional(v.pipe(v.array(v.string()), v.maxLength(MAX_INVITE_EMAILS)), []),
  /** Without it a repeated request could fill an inbox. */
  resend: v.optional(v.boolean(), false),
});
