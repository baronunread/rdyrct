import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { useCurrentUser } from "./hooks";
import { getCurrentOrgId, setCurrentOrgId, subscribeToOrg } from "./org-store";
import type { UserOrg } from "@/shared/types";

export function useCurrentOrg(): {
  org: UserOrg | null;
  orgs: UserOrg[];
  setOrg: (id: string) => void;
} {
  const me = useCurrentUser();
  const orgs = me.data?.orgs ?? [];
  const storedId = useSyncExternalStore(subscribeToOrg, getCurrentOrgId);
  const org = orgs.find((o) => o.id === storedId) ?? orgs[0] ?? null;

  const orgId = org?.id ?? null;
  useEffect(() => {
    if (orgId && orgId !== storedId) setCurrentOrgId(orgId);
  }, [orgId, storedId]);

  return { org, orgs, setOrg: setCurrentOrgId };
}
