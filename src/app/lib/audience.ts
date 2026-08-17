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
  const me = useCurrentUser();
  const [authHint] = useState(readAuthHint);
  const authed = me.isPending ? authHint : !!me.data;
  const cta = authed
    ? { ctaTo: "/dashboard", ctaLabel: "Open dashboard" }
    : { ctaTo: "/signup", ctaLabel: "Get started free" };
  return { authed, name: me.data?.user.name ?? "", ...cta };
}
