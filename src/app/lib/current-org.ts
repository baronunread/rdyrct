import { useEffect, useSyncExternalStore } from "react";
import { useCurrentUser, useShellUser } from "./hooks";
import type { UserOrg } from "@/shared/types";

// There is no org id in the URL: the current org lives here, backed by
// localStorage so a reload keeps it.

const KEY = "rdyrct:currentOrg";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let currentId: string | null = read();
const listeners = new Set<() => void>();

function setCurrentOrgId(id: string | null) {
  currentId = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
}

const getCurrentOrgId = () => currentId;

function subscribeToOrg(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// One rule for the hook and the route loaders, which pick the org before any component mounts.
export function pickOrg(orgs: UserOrg[], storedId: string | null = getCurrentOrgId()) {
  return orgs.find((o) => o.id === storedId) ?? orgs[0] ?? null;
}

// The sidebar's switcher passes the cached list so a reload keeps drawing it; everything
// else passes the checked one. Org identity is the same either way, org settings are not,
// which is why only the switcher may read the cached list.
function usePickOrg(orgs: UserOrg[]) {
  const storedId = useSyncExternalStore(subscribeToOrg, getCurrentOrgId, () => null);
  const org = pickOrg(orgs, storedId);

  const orgId = org?.id ?? null;
  useEffect(() => {
    if (orgId && orgId !== storedId) setCurrentOrgId(orgId);
  }, [orgId, storedId]);

  return { org, orgs, setOrg: setCurrentOrgId };
}

// `enabled: false` asks nothing, for a public page that only needs the hook's shape
// (a stranger's /user would 401).
export function useCurrentOrg(enabled = true) {
  const currentUser = useCurrentUser(enabled);
  return usePickOrg(currentUser.data?.orgs ?? []);
}

export function useShellOrgs() {
  return usePickOrg(useShellUser()?.orgs ?? []);
}
