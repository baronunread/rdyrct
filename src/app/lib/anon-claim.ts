/**
 * The claim token for a link made on the landing page before signing up
 * (Direction A of #96).
 *
 * localStorage, not a cookie: the token is only ever read by this app in this
 * browser, and a cookie would ride along on every request to no purpose.
 *
 * It is written the moment the link is created and spent once the new account
 * has an org. Losing it costs a 24-hour link and nothing else, which is why
 * every failure here is silent: a storage-blocked browser must still be able
 * to shorten a link and sign up.
 */
import { api } from "./api";

const KEY = "rdyrct:claim:v1";

export function rememberClaim(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // Private mode, or storage disabled. The link still works for 24 hours.
  }
}

function pendingClaim(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function forgetClaim(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clean up if we could not write in the first place */
  }
}

/**
 * Spends a pending claim on a freshly created org, if there is one.
 *
 * Best-effort in every direction: no claim is the common case, a rejected
 * claim means the link expired or somebody already took it, and neither is
 * worth a message. The person came here to make an organization and that
 * already worked.
 *
 * The token is forgotten either way, so a link that cannot be claimed does
 * not follow someone around forever.
 */
export async function claimPendingLink(orgId: string): Promise<boolean> {
  const token = pendingClaim();
  if (!token) return false;
  forgetClaim();
  try {
    await api(`/orgs/${orgId}/links/claim`, { method: "POST", body: { claimToken: token } });
    return true;
  } catch {
    return false;
  }
}
