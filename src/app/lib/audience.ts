import { useState } from "react";
import { useCurrentUser } from "./hooks";
import { readAuthHint } from "./user-cache";

/**
 * Whether to draw this page for a stranger or a customer, and what the top
 * call to action should say.
 *
 * While the /user query is in flight it falls back to the last known auth
 * state, so a signed-in visitor does not see "Sign up" flash before the
 * header settles. Snapshotted once: mid-visit flips come from the query.
 */
export function useAudience() {
  const [authHint] = useState(readAuthHint);
  // A browser that has never held a session has nothing to ask about: the
  // query would 401 and land back on this same answer, having logged a page
  // error on the way. Once it has been signed in the hint says so, the query
  // runs, and an expired session corrects the header a round trip later.
  const currentUser = useCurrentUser(authHint);
  const authed = currentUser.isPending ? authHint : !!currentUser.data;
  const cta = authed
    ? { ctaTo: "/dashboard", ctaLabel: "Open dashboard" }
    : { ctaTo: "/signup", ctaLabel: "Get started free" };
  return { authed, name: currentUser.data?.user.name ?? "", ...cta };
}
