import { useMemo } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { domainsQuery, useCurrentUser, useDomains } from "./hooks";
import { useCurrentOrg } from "./current-org";
import { orgQrFrom } from "./org-qr";
import { resolveDefaultDomainId } from "./default-domain";
import { PLAN_LIMITS, type CurrentUser, type OrgRole, type UserOrg } from "@/shared/types";

export function canListOrgDomains(isPlatformAdmin: boolean, role: OrgRole | undefined): boolean {
  return isPlatformAdmin || role === "owner" || role === "admin";
}

// Undefined role means the org has not loaded: not a moment to offer a write (#157).
// Locked-aware: a locked org accepts no writes from anyone, its owner and platform
// admins included, because the server refuses them too (#160).
export function canAdminOrg(
  isPlatformAdmin: boolean | undefined,
  role: OrgRole | undefined,
  locked = false,
): boolean {
  if (locked) return false;
  return !!isPlatformAdmin || role === "owner" || role === "admin";
}

export function canWriteOrg(role: OrgRole | undefined, locked = false): boolean {
  // A locked org is read-only for everyone in it, its owner included (#160): the same
  // answer as a viewer's.
  if (locked) return false;
  return role === "owner" || role === "admin" || role === "member";
}

// A locked org is on a plan that covers fewer orgs than its owner has, not short of a plan:
// "custom domains need a paid plan" is wrong to a Hobby owner (#159, #160).
export function domainsBlockedBy(planDomains: number, locked: boolean): "lock" | "plan" | null {
  if (locked) return "lock";
  return planDomains > 0 ? null : "plan";
}

export function preloadOrgDomains(qc: QueryClient, org: UserOrg, user: CurrentUser) {
  return canListOrgDomains(user.user.isAdmin, org.role)
    ? qc.ensureQueryData(domainsQuery(org.id))
    : undefined;
}

export function useOrgLimits() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const limits = org?.limits ?? PLAN_LIMITS.free;
  const canListDomains = canListOrgDomains(!!currentUser.data?.user.isAdmin, org?.role);
  const domains = useDomains(orgId, canListDomains);
  // `lockedAt` as well as `status`: a downgrade leaves a domain `active` and locked,
  // and a locked one takes no new links (#159).
  const activeDomains = useMemo(
    () => (domains.data ?? []).filter((d) => d.status === "active" && d.lockedAt === null),
    [domains.data],
  );
  const orgQr = orgQrFrom(org);
  const canWrite = canWriteOrg(org?.role, org?.locked);
  // Resolved here, so nothing preselects a domain that stopped serving (#69).
  const defaultDomainId = resolveDefaultDomainId(org?.defaultDomainId, activeDomains);
  return {
    org,
    orgId,
    currentUser,
    limits,
    canWrite,
    canListDomains,
    domains,
    activeDomains,
    orgQr,
    defaultDomainId,
  };
}
