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

export function useAudience() {
  // Static HTML and the first browser render both use the signed-out view. Read browser-only
  // snapshots after hydration so header markup matches what the server sent.
  const authHint = useSyncExternalStore(subscribeToNothing, readAuthHint, serverSnapshot);
  const hydrated = useSyncExternalStore(subscribeToNothing, clientHydrated, serverSnapshot);
  // A browser that never held a session has nothing to ask about: the query would 401
  // and log a page error. Once signed in, the hint says so and the query runs.
  const currentUser = useCurrentUser(authHint);
  const authed = resolveAuth(authHint, currentUser);
  const ready = isAudienceReady(hydrated, authHint, currentUser.isPending);
  return { authed, ready, name: currentUser.data?.user.name ?? "", ...audienceCta(authed) };
}
