/**
 * Cloudflare Turnstile in front of signup, password reset, the anonymous
 * shortener and the abuse report form (#304).
 *
 * The browser solves the challenge and hands us a single-use token; we ask
 * Cloudflare's siteverify whether it is good. Siteverify also burns the
 * token, so there is no state of our own to keep.
 */
import * as v from "valibot";
import type { Env } from "./env";

/** Binds the widget to the form it was rendered for: siteverify echoes the
 * `action` back, so a token earned on one form cannot open another. */
export type TurnstileScope = "signup" | "password-reset" | "anon-link" | "report";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Long enough for a slow answer, short enough that a hung verifier does not
 * hold the form open. A timeout counts as unreachable, so it refuses. */
const SITEVERIFY_TIMEOUT_MS = 10_000;

/** The fields of siteverify's answer this file reads. */
const siteverifySchema = v.object({
  success: v.boolean(),
  action: v.optional(v.string()),
  "error-codes": v.optional(v.array(v.string()), []),
  metadata: v.optional(v.object({ result_with_testing_key: v.optional(v.boolean()) })),
});
type SiteverifyAnswer = v.InferOutput<typeof siteverifySchema>;

/** Asks Cloudflare about one token. null when it did not answer in a shape we
 * can read, which the caller treats as a refusal. */
async function siteverify(secret: string, token: string): Promise<SiteverifyAnswer | null> {
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      // No remoteip: it is optional, and we do not hand visitor addresses to
      // anyone we do not have to.
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    // siteverify answers 200 for a refusal too; anything else is Cloudflare
    // having trouble, not a verdict.
    if (!res.ok) {
      console.error("turnstile_unreachable", res.status);
      return null;
    }
    const parsed = v.safeParse(siteverifySchema, await res.json());
    return parsed.success ? parsed.output : null;
  } catch (cause) {
    console.error("turnstile_unreachable", cause);
    return null;
  }
}

/**
 * Whether the token was rendered for this form. Cloudflare's test secret
 * passes every token and never echoes an action, so its answers are taken
 * as they are: that secret lets everything through anyway, so skipping the
 * action check on it gives nothing away.
 */
function actionMatches(answer: SiteverifyAnswer, scope: TurnstileScope): boolean {
  return answer.action === scope || answer.metadata?.result_with_testing_key === true;
}

/**
 * Checks the token a form submitted.
 *
 * Off unless TURNSTILE_SECRET_KEY is set, matching SENTRY_DSN and friends:
 * self-hosters run without it. Keyed on the secret, not the site key: a
 * secret with no site key must refuse every request, never quietly turn the
 * check off.
 *
 * The caller is told nothing beyond "no", because the reason tells a bot
 * which knob to turn; the log is where a support report finds out whether it
 * was a missing token, a replay, or a wrong secret.
 */
export async function spendToken(env: Env, scope: TurnstileScope, token: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) {
    console.warn("turnstile_refused", scope, "missing");
    return false;
  }

  // Fail closed: an unreachable verifier is no reason to let bots in.
  const answer = await siteverify(env.TURNSTILE_SECRET_KEY, token);
  if (!answer) return false;

  const ok = answer.success && actionMatches(answer, scope);
  if (!ok) console.warn("turnstile_refused", scope, answer["error-codes"].join(",") || "action");
  return ok;
}
