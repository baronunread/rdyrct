import { useMemo } from "react";
import { useCurrentUser, useDomains } from "./hooks";
import { useCurrentOrg } from "./current-org";
import { orgQrFrom } from "./org-qr";
import { PLAN_LIMITS, type OrgRole } from "@/shared/types";

/** Platform admins can always see an org's domains; otherwise only its
 * owner or admins can (members can't manage custom domains). */
export function canListOrgDomains(isPlatformAdmin: boolean, role: OrgRole | undefined): boolean {
  return isPlatformAdmin || role === "owner" || role === "admin";
}

export function useOrgLimits() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();
  const limits = PLAN_LIMITS[org?.plan ?? "free"];
  const canListDomains = canListOrgDomains(!!me.data?.user.isAdmin, org?.role);
  const domains = useDomains(orgId, canListDomains);
  const activeDomains = useMemo(
    () => (domains.data ?? []).filter((d) => d.status === "active"),
    [domains.data],
  );
  const orgQr = orgQrFrom(org);
  return { org, orgId, me, limits, canListDomains, domains, activeDomains, orgQr };
}
