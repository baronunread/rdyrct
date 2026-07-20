import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { useCurrentUser } from "./hooks";
import type { UserOrg } from "@/shared/types";

// The app no longer carries the org id in the URL (pages live at /dashboard,
// /links, …). The "current org" is a tiny reactive store backed by
// localStorage so switching orgs in one place updates every page.
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

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Resolves the active org from the store, falling back to the first org the
 * user belongs to. `setOrg` persists the choice and re-renders every consumer.
 */
export function useCurrentOrg(): {
  org: UserOrg | null;
  orgs: UserOrg[];
  setOrg: (id: string) => void;
} {
  const me = useCurrentUser();
  const orgs = me.data?.orgs ?? [];
  const storedId = useSyncExternalStore(subscribe, () => currentId);
  const org = orgs.find((o) => o.id === storedId) ?? orgs[0] ?? null;

  // Persist the resolved org when the stored id is stale/absent (e.g. the org
  // was left/deleted, or this is the first load) so the store stays in sync.
  const orgId = org?.id ?? null;
  useEffect(() => {
    if (orgId && orgId !== storedId) setCurrentOrgId(orgId);
  }, [orgId, storedId]);

  return { org, orgs, setOrg: setCurrentOrgId };
}
