/**
 * Which sign-in method this browser used last, and (for Google) which
 * account, so the login and signup pages can offer a one-click "continue as
 * you". A convenience hint kept in localStorage: a wrong or missing value
 * only costs one extra click.
 */
import * as v from "valibot";

export type AuthMethod = "google" | "password";

const KEY = "rdyrct:last-auth:v1";

const schema = v.object({
  method: v.picklist(["google", "password"]),
  email: v.optional(v.string()),
});

export type LastAuth = v.InferOutput<typeof schema>;

/**
 * Record the method, and the email when we have it. Called with just the
 * method (e.g. before the Google redirect, when the address isn't known
 * yet) it keeps whatever email was stored for that method.
 */
export function setLastAuth(method: AuthMethod, email?: string): void {
  try {
    const prev = lastAuth();
    const kept = email ?? (prev?.method === method ? prev.email : undefined);
    localStorage.setItem(KEY, JSON.stringify(kept ? { method, email: kept } : { method }));
  } catch {
    // private mode or storage disabled: the hint is optional.
  }
}

export function lastAuth(): LastAuth | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = v.safeParse(schema, JSON.parse(raw));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}
