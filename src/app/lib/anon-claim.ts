/**
 * The claim tokens for links made on the landing page before signing up
 * (Direction A of #96).
 *
 * A list, not a single token: the hero lets somebody shorten several links
 * in a row and offers to keep all of them, so storing one would quietly make
 * "keep these 3 links" a promise about the last one.
 *
 * localStorage, not a cookie: these are only ever read by this app in this
 * browser, and a cookie would ride along on every request to no purpose.
 *
 * They are written the moment each link is created and spent once the new
 * account has an org. Losing them costs a handful of 24-hour links and
 * nothing else, which is why every failure here is silent: a storage-blocked
 * browser must still be able to shorten a link and sign up.
 */
import { api } from "./api";

const KEY = "rdyrct:claim:v2";

/** The most links one visit can hand over. Above the anonymous shortener's
 * own rate limit, so it never truncates a real session, and low enough that
 * a stuffed localStorage cannot turn signup into a hundred requests. */
const MAX_PENDING = 10;

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Anything unexpected is discarded rather than repaired: this is a
    // convenience, and a browser holding junk under our key should not be
    // able to shape the requests signup makes.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string").slice(0, MAX_PENDING);
  } catch {
    return [];
  }
}

export function rememberClaim(token: string): void {
  try {
    const tokens = read();
    if (tokens.includes(token)) return;
    localStorage.setItem(KEY, JSON.stringify([...tokens, token].slice(-MAX_PENDING)));
  } catch {
    // Private mode, or storage disabled. The links still work for 24 hours.
  }
}

function forgetClaims(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clean up if we could not write in the first place */
  }
}

/**
 * Hands every pending link to a freshly created org, and reports how many
 * landed.
 *
 * Best-effort in every direction: no claim is the common case, and a
 * rejected one means the link expired or somebody already took it. Neither
 * is worth a message, because the person came here to make an organization
 * and that already worked.
 *
 * Together rather than one after another: these are independent requests
 * and the person is waiting on the org they just made, so ten of them in
 * series would be ten round trips of dead time. They are forgotten before
 * the first request, so a claim that cannot be spent does not follow
 * somebody around forever.
 */
export async function claimPendingLinks(orgId: string): Promise<number> {
  const tokens = read();
  if (tokens.length === 0) return 0;
  forgetClaims();

  // allSettled, not all: a token that expired, was already taken, or would
  // push the org over its link cap must not stop the others landing.
  const results = await Promise.allSettled(
    tokens.map((claimToken) =>
      api(`/orgs/${orgId}/links/claim`, { method: "POST", body: { claimToken } }),
    ),
  );
  return results.filter((r) => r.status === "fulfilled").length;
}
