import { useEffect, useSyncExternalStore } from "react";
import { useCurrentUser } from "./hooks";

// There is no org id in the URL: the current org lives here, backed by
// localStorage so a reload keeps it. Store and hook share one file because
// the hook was the store's only reader.

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
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

const getCurrentOrgId = () => currentId;

function subscribeToOrg(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCurrentOrg() {
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
