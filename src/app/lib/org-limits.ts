import { useMemo } from "react";
import { useCurrentUser, useDomains } from "./hooks";
import { useCurrentOrg } from "./current-org";
import { orgQrFrom } from "./org-qr";
import { PLAN_LIMITS } from "@/shared/types";

export function useOrgLimits() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const me = useCurrentUser();
  const limits = PLAN_LIMITS[org?.plan ?? "free"];
  const canListDomains =
    !!me.data?.user.isAdmin || org?.role === "owner" || org?.role === "admin";
  const domains = useDomains(orgId, canListDomains);
  const activeDomains = useMemo(
    () => (domains.data ?? []).filter((d) => d.status === "active"),
    [domains.data],
  );
  const orgQr = orgQrFrom(org);
  return { org, orgId, me, limits, canListDomains, domains, activeDomains, orgQr };
}
