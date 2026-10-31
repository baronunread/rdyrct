import { useCurrentOrg } from "./current-org";
import { useCurrentUser, useLinkQuotaUsage } from "./hooks";
import { useOrgSetup, type OrgSetup } from "./setup";
import type { UserOrg } from "@/shared/types";

/** Only the owner sets an org up: the name and the plan are theirs, and
 * domains and invites are admin work a member could not finish anyway. */
function setsUp(org: UserOrg | null): org is UserOrg {
  return !!org && org.role === "owner" && !org.locked;
}

/** Whether /welcome should run the setup flow, once that is known. */
interface WelcomeList {
  known: boolean;
  listed: boolean;
}

/**
 * The flow runs for an owner whose org has no links yet, however they signed
 * in. Coming back from a checkout the flow sent them to (`fromCheckout`), it
 * resumes even though the flow has by then made a link. Never for an org
 * that is set up otherwise: an existing account through a pricing link, or
 * one that left the flow and went on to make links, keeps its dashboard.
 * `known` stays false until the count is in.
 */
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
