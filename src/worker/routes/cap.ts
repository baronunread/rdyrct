/**
 * The two public endpoints Cap's widget talks to (#98).
 *
 * Public by design: they sit in front of signup, so requiring a session
 * would defeat the point. They are covered by the same public auth rate
 * limit as /api/auth/*, and issuing a challenge is cheap while solving one
 * is not, which is the asymmetry the whole scheme rests on.
 */
import { Hono } from "hono";
import { optionalText, parseOptionalBody } from "../schemas";
import * as v from "valibot";
import type { JsonValue } from "../../shared/types";
import type { AppEnv } from "../env";
import { capEnabled, issueChallenge, verifySolution, type CapScope } from "../cap";

const SCOPES: readonly CapScope[] = ["signup", "password-reset", "anon-link"];

/** The scope rides in the path, not the body: Cap's widget builds its own
 * request bodies and only lets us choose the endpoint prefix. */
function readScope(value: JsonValue): CapScope | null {
  return SCOPES.find((s) => s === value) ?? null;
}

/** What the redeem route reads off its request body. A solution set that is
 * not a list of numbers is not a solution set. */
const redeemBodySchema = v.object({
  token: optionalText,
  solutions: v.optional(v.fallback(v.nullable(v.array(v.number())), null), null),
});

export const capRoutes = new Hono<AppEnv>();

capRoutes.post("/:scope/challenge", async (c) => {
  if (!capEnabled(c.env)) return c.json({ disabled: true });
  const scope = readScope(c.req.param("scope"));
  if (!scope) return c.json({ message: "Unknown scope" }, 400);
  return c.json(await issueChallenge(c.env, scope));
});

capRoutes.post("/:scope/redeem", async (c) => {
  if (!capEnabled(c.env)) return c.json({ disabled: true });
  const scope = readScope(c.req.param("scope"));
  const body = parseOptionalBody(redeemBodySchema, await c.req.json<JsonValue>().catch(() => ({})));
  if (!scope || !body.token || !body.solutions)
    return c.json({ success: false, message: "Malformed solution" }, 400);

  const result = await verifySolution(c.env, scope, {
    token: body.token,
    solutions: body.solutions,
  });
  // The reason is deliberately not echoed: it tells a bot which knob to
  // turn, and tells a person nothing they can act on.
  if (!result.success) return c.json({ success: false }, 400);

  return c.json({ success: true, token: result.token, expires: result.expires });
});
