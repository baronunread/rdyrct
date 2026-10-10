/**
 * Cloudflare Turnstile in front of signup, password reset and the anonymous
 * shortener (#304).
 *
 * The browser solves the challenge and hands us a single-use token; we ask
 * Cloudflare's siteverify whether it is good. Siteverify also burns the
 * token, so there is no state of our own to keep.
 */
import type { Env } from "./env";

/** Binds the widget to the form it was rendered for: siteverify echoes the
 * `action` back, so a token earned on one form cannot open another. */
export type TurnstileScope = "signup" | "password-reset" | "anon-link";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Off unless TURNSTILE_SECRET_KEY is set, matching SENTRY_DSN and friends:
 * self-hosters and local dev run without it. Keyed on the secret, not the
 * site key: a secret with no site key must refuse every request, never
 * quietly turn the check off. */
export function turnstileEnabled(env: Env): boolean {
  return !!env.TURNSTILE_SECRET_KEY;
}

interface SiteverifyResponse {
  success: boolean;
  action?: string;
  "error-codes"?: string[];
}

/**
 * Checks the token a form submitted.
 *
 * The caller is told nothing beyond "no", because the reason tells a bot
 * which knob to turn; the log is where a support report finds out whether it
 * was a missing token, a replay, or a wrong secret.
 */
export async function spendToken(env: Env, scope: TurnstileScope, token: string): Promise<boolean> {
  if (!turnstileEnabled(env)) return true;
  if (!token) {
    console.warn("turnstile_refused", scope, "missing");
    return false;
  }

  let result: SiteverifyResponse;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      // No remoteip: it is optional, and we do not hand visitor addresses to
      // anyone we do not have to.
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token }),
    });
    // SAFETY: siteverify documents this JSON shape; success is the only field
    // read without a fallback, and a missing one reads as a refusal.
    result = (await res.json()) as SiteverifyResponse;
  } catch (cause) {
    // Fail closed: an unreachable verifier is no reason to let bots in.
    console.error("turnstile_unreachable", cause);
    return false;
  }

  const ok = result.success === true && result.action === scope;
  if (!ok) console.warn("turnstile_refused", scope, result["error-codes"]?.join(",") ?? "action");
  return ok;
}
