import { useSyncExternalStore } from "react";
import { useCurrentUser } from "./hooks";
import { readAuthHint } from "./user-cache";

const subscribeToNothing = () => () => {};
const clientHydrated = () => true;
const serverSnapshot = () => false;

function audienceCta(authed: boolean) {
  return authed
    ? { ctaTo: "/dashboard", ctaLabel: "Open dashboard" }
    : { ctaTo: "/signup", ctaLabel: "Get started free" };
}

function resolveAuth(authHint: boolean, currentUser: ReturnType<typeof useCurrentUser>) {
  return currentUser.isPending ? authHint : !!currentUser.data;
}

function isAudienceReady(hydrated: boolean, authHint: boolean, pending: boolean) {
  return hydrated && !(authHint && pending);
}

/**
 * Whether to draw this page for a stranger or a customer, and what the top
 * call to action should say.
 *
 * While the /user query is in flight it falls back to the last known auth
 * state, so a signed-in visitor does not see "Sign up" flash before the
 * header settles. Snapshotted once: mid-visit flips come from the query.
 */
export function useAudience() {
  // Static HTML and its first browser render both use the signed-out view.
  // Read browser-only snapshots after hydration so signed-in visitors do not
  // hydrate different header markup from the page the server sent.
  const authHint = useSyncExternalStore(subscribeToNothing, readAuthHint, serverSnapshot);
  const hydrated = useSyncExternalStore(subscribeToNothing, clientHydrated, serverSnapshot);
  // A browser that has never held a session has nothing to ask about: the
  // query would 401 and land back on this same answer, having logged a page
  // error on the way. Once it has been signed in the hint says so, the query
  // runs, and an expired session corrects the header a round trip later.
  const currentUser = useCurrentUser(authHint);
  const authed = resolveAuth(authHint, currentUser);
  const ready = isAudienceReady(hydrated, authHint, currentUser.isPending);
  return { authed, ready, name: currentUser.data?.user.name ?? "", ...audienceCta(authed) };
}
