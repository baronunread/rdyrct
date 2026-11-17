/**
 * Siteverify also burns the token, so there is no state of our own to keep (#304).
 */
import * as v from "valibot";
import type { Env } from "./env";
import { logFailure } from "./log-failure";

/** Siteverify echoes `action` back, so a token earned on one form cannot open another. */
export type TurnstileScope = "signup" | "password-reset" | "anon-link" | "report";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** A timeout counts as unreachable, so it refuses. */
const SITEVERIFY_TIMEOUT_MS = 10_000;

const siteverifySchema = v.object({
  success: v.boolean(),
  action: v.optional(v.string()),
  "error-codes": v.optional(v.array(v.string()), []),
});
type SiteverifyAnswer = v.InferOutput<typeof siteverifySchema>;

/** None echoes an action. Matched against our own secret, never against siteverify's answer. */
const TEST_SECRETS: ReadonlySet<string> = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

/**
 * Both keys or neither: one without the other looks protected and is not, so it
 * refuses every guarded form. Set both in one `wrangler secret bulk` call.
 */
export function turnstileMode(env: Env): "on" | "off" | "misconfigured" {
  const site = !!env.TURNSTILE_SITE_KEY;
  const secret = !!env.TURNSTILE_SECRET_KEY;
  if (site && secret) return "on";
  return site || secret ? "misconfigured" : "off";
}

export function servedSiteKey(env: Env): string | undefined {
  return turnstileMode(env) === "on" ? env.TURNSTILE_SITE_KEY : undefined;
}

async function siteverify(secret: string, token: string): Promise<SiteverifyAnswer | null> {
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      // No remoteip: it is optional, and we do not hand visitor addresses to
      // anyone we do not have to.
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
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

/** Cloudflare's test secrets never echo an action, so a deployment running on one skips this. */
function actionMatches(answer: SiteverifyAnswer, scope: TurnstileScope, secret: string): boolean {
  return answer.action === scope || TEST_SECRETS.has(secret);
}

/**
 * The caller is told only "no": the reason tells a bot which knob to turn. The
 * log says whether it was a missing token, a replay, or a wrong secret.
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
