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

export function setCurrentOrgId(id: string | null) {
  currentId = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function getCurrentOrgId(): string | null {
  return currentId;
}

export function subscribeToOrg(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
