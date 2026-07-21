// Last known auth state, persisted so the first paint after a reload can
// render the right header (Dashboard vs Sign up) before the /user query
// resolves. It is a hint only: `useCurrentUser` remains the source of truth
// and rewrites it every time the query settles.
const KEY = "rdyrct:authed";

export function readAuthHint(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAuthHint(authed: boolean) {
  try {
    if (authed) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
