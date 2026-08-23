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

/**
 * Whether this role may change anything in the org (#157).
 *
 * A viewer reads everything and writes nothing, so every control that would
 * submit has to be hidden rather than left to fail: the server refuses them
 * with a 403, and a button whose only outcome is an error toast is not a
 * feature. Undefined role means the org has not loaded, which is also not a
 * moment to offer a write.
 */
export function canWriteOrg(role: OrgRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "member";
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
  // Every page that can offer a write already calls this hook, so the answer
  // lives here rather than being re-derived from the role at each control.
  const canWrite = canWriteOrg(org?.role);
  // Resolved here rather than at each call site, so nothing preselects a
  // domain that stopped serving (#69).
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
