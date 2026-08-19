import { useEffect, useSyncExternalStore } from "react";
import { useCurrentUser, useShellUser } from "./hooks";
import type { UserOrg } from "@/shared/types";

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

/**
 * Which of these is the current one, and remember it.
 *
 * Two callers pass two different lists: the sidebar's switcher passes the
 * cached one so a reload keeps drawing it, and everything else passes the
 * checked one. Org identity is the same either way; org settings are not,
 * which is why only the switcher may read the cached list.
 */
function usePickOrg(orgs: UserOrg[]) {
  const storedId = useSyncExternalStore(subscribeToOrg, getCurrentOrgId);
  const org = orgs.find((o) => o.id === storedId) ?? orgs[0] ?? null;

  const orgId = org?.id ?? null;
  useEffect(() => {
    if (orgId && orgId !== storedId) setCurrentOrgId(orgId);
  }, [orgId, storedId]);

  return { org, orgs, setOrg: setCurrentOrgId };
}

/** The current org as the app knows it: waits for the checked answer. */
export function useCurrentOrg() {
  const currentUser = useCurrentUser();
  return usePickOrg(currentUser.data?.orgs ?? []);
}

/** The current org as the sidebar draws it, cache included. Chrome only. */
export function useShellOrgs() {
  return usePickOrg(useShellUser()?.orgs ?? []);
}
