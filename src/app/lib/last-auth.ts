import * as v from "valibot";

export type AuthMethod = "google" | "password";

const KEY = "rdyrct:last-auth:v1";

const schema = v.object({
  method: v.picklist(["google", "password"]),
  email: v.optional(v.string()),
});

export type LastAuth = v.InferOutput<typeof schema>;

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
