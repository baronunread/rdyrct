/**
 * Which sign-in method this browser used last, so the login and signup pages
 * can point a returning visitor at the same one. A convenience hint, kept in
 * localStorage: a wrong or missing value only costs one extra glance.
 */
export type AuthMethod = "google" | "password";

const KEY = "lastAuthMethod";

export function setLastAuthMethod(method: AuthMethod): void {
  try {
    localStorage.setItem(KEY, method);
  } catch {
    // private mode or storage disabled: the hint is optional.
  }
}

export function lastAuthMethod(): AuthMethod | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "google" || v === "password" ? v : null;
  } catch {
    return null;
  }
}
