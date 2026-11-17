import { useCurrentOrg } from "./current-org";
import { useCurrentUser, useLinkQuotaUsage } from "./hooks";
import { useOrgSetup, type OrgSetup } from "./setup";
import type { UserOrg } from "@/shared/types";

function setsUp(org: UserOrg | null): org is UserOrg {
  return !!org && org.role === "owner" && !org.locked;
}

interface WelcomeList {
  known: boolean;
  listed: boolean;
}

// Coming back from a checkout the flow sent them to (`fromCheckout`), it resumes even
// though the flow has by then made a link. Never for an org that is set up otherwise.
export function useWelcomeList(fromCheckout = false): WelcomeList {
  const user = useCurrentUser();
  const { org } = useCurrentOrg();
  const orgId = setsUp(org) ? org.id : "";
  const setup = useOrgSetup(orgId);
  const links = useLinkQuotaUsage(orgId);
  // No org yet is "still loading", not "not an owner".
  if (!user.data) return { known: false, listed: false };
  return welcomeList(orgId, links.data?.count, fromCheckout ? setup : undefined, setup?.finished);
}

function welcomeList(
  orgId: string,
  links: number | undefined,
  setup: OrgSetup | undefined,
  finished: boolean | undefined,
) {
  if (!orgId || finished) return { known: true, listed: false } satisfies WelcomeList;
  if (setup) return { known: true, listed: true } satisfies WelcomeList;
  if (links === undefined) return { known: false, listed: false } satisfies WelcomeList;
  return { known: true, listed: links === 0 } satisfies WelcomeList;
}
