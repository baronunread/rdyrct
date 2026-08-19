import { useMemo } from "react";
import { useCurrentUser, useDomains } from "./hooks";
import { useCurrentOrg } from "./current-org";
import { orgQrFrom } from "./org-qr";
import { resolveDefaultDomainId } from "./default-domain";
import { PLAN_LIMITS, type OrgRole } from "@/shared/types";

/** Platform admins can always see an org's domains; otherwise only its
 * owner or admins can (members can't manage custom domains). */
export function canListOrgDomains(isPlatformAdmin: boolean, role: OrgRole | undefined): boolean {
  return isPlatformAdmin || role === "owner" || role === "admin";
}

export function useOrgLimits() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const limits = PLAN_LIMITS[org?.plan ?? "free"];
  const canListDomains = canListOrgDomains(!!currentUser.data?.user.isAdmin, org?.role);
  const domains = useDomains(orgId, canListDomains);
  const activeDomains = useMemo(
    () => (domains.data ?? []).filter((d) => d.status === "active"),
    [domains.data],
  );
  const orgQr = orgQrFrom(org);
  // Resolved here rather than at each call site, so nothing preselects a
  // domain that stopped serving (#69).
  const defaultDomainId = resolveDefaultDomainId(org?.defaultDomainId, activeDomains);
  return {
    org,
    orgId,
    currentUser,
    limits,
    canListDomains,
    domains,
    activeDomains,
    orgQr,
    defaultDomainId,
  };
}
