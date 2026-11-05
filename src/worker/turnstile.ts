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
import { logFailure } from "./log-failure";

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
});
type SiteverifyAnswer = v.InferOutput<typeof siteverifySchema>;

/** Cloudflare's published test secrets (always pass, always fail, already
 * spent). None of them echoes an action. Matched against our own secret,
 * never against anything siteverify says about itself. */
const TEST_SECRETS: ReadonlySet<string> = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

/**
 * Whether Turnstile is on for this deployment. Both keys or neither: one
 * without the other is a deployment that looks protected and is not, so it
 * is "misconfigured", which refuses every guarded form and serves no site
 * key. Set both in one `wrangler secret bulk` call so no deploy sees half.
 */
export function turnstileMode(env: Env): "on" | "off" | "misconfigured" {
  const site = !!env.TURNSTILE_SITE_KEY;
  const secret = !!env.TURNSTILE_SECRET_KEY;
  if (site && secret) return "on";
  return site || secret ? "misconfigured" : "off";
}

/** The site key the browser should render, only when the check is on. */
export function servedSiteKey(env: Env): string | undefined {
  return turnstileMode(env) === "on" ? env.TURNSTILE_SITE_KEY : undefined;
}

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
      logFailure("turnstile_unreachable", undefined, { status: res.status });
      return null;
    }
    const parsed = v.safeParse(siteverifySchema, await res.json());
    return parsed.success ? parsed.output : null;
  } catch (cause) {
    logFailure("turnstile_unreachable", cause);
    return null;
  }
}

/**
 * Whether the token was rendered for this form. Cloudflare's test secrets
 * never echo an action, so a deployment running on one skips this check:
 * those secrets decide every token in advance, so it gives nothing away.
 */
function actionMatches(answer: SiteverifyAnswer, scope: TurnstileScope, secret: string): boolean {
  return answer.action === scope || TEST_SECRETS.has(secret);
}

/**
 * Checks the token a form submitted.
 *
 * Off with neither key set, matching SENTRY_DSN and friends: self-hosters
 * run without it. With only one of the two it refuses (see turnstileMode).
 *
 * The caller is told nothing beyond "no", because the reason tells a bot
 * which knob to turn; the log is where a support report finds out whether it
 * was a missing token, a replay, or a wrong secret.
 */
export async function spendToken(env: Env, scope: TurnstileScope, token: string): Promise<boolean> {
  const mode = turnstileMode(env);
  if (mode === "off") return true;
  if (mode === "misconfigured") {
    logFailure(
      "turnstile_misconfigured",
      "set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither",
    );
    return false;
  }
  if (!token) {
    logFailure("turnstile_refused", undefined, { scope, reason: "missing" });
    return false;
  }

  // Fail closed: an unreachable verifier is no reason to let bots in.
  const secret = env.TURNSTILE_SECRET_KEY ?? "";
  const answer = await siteverify(secret, token);
  if (!answer) return false;

  const ok = answer.success && actionMatches(answer, scope, secret);
  if (!ok)
    logFailure("turnstile_refused", undefined, {
      scope,
      reason: answer["error-codes"].join(",") || "action",
    });
  return ok;
}
