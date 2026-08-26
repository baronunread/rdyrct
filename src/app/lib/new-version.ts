// A code-split chunk failing to load almost always means a stale tab: a
// visitor has a tab open whose hashed asset filenames no longer exist after a
// deploy. Rather than reload (which flashes and can loop on a broken deploy)
// or crash, we surface an in-app "new version available" banner and let the
// visitor reload when they choose. This store is the bridge between the
// non-React `vite:preloadError` handler and the React banner.

let available = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function signalNewVersionAvailable() {
  if (available) return;
  available = true;
  emit();
}

export function dismissNewVersion() {
  if (!available) return;
  available = false;
  emit();
}

export function subscribeNewVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNewVersion(): boolean {
  return available;
}

export function reloadNow() {
  window.location.reload();
}
