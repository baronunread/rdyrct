// A code-split chunk failing to load almost always means a stale tab: a
// visitor has a tab open whose hashed asset filenames no longer exist after a
// deploy. When it fails in the background (`vite:preloadError`, the visitor
// still on a working page) we surface this "new version available" banner and
// let them reload when they choose. When it fails while rendering a route
// they just navigated to, the old UI is already gone, so the error boundary
// forces one reload instead (`reloadForNewVersion`). This store is the bridge
// between the non-React `vite:preloadError` handler and the React banner.

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

const RELOADED_KEY = "rdyrct:chunk-reloaded";

/**
 * One forced reload onto the current build, for when a chunk failed while
 * rendering a route the visitor just navigated to: the old UI is already
 * gone, so a reload is the fix, not a banner over a blank page. Guarded by a
 * session flag so a genuinely broken deploy (reload doesn't fix the chunk)
 * can't loop: the second chunk failure in a session returns false and the
 * caller falls back to the notice.
 */
export function reloadForNewVersion(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_KEY)) return false;
    sessionStorage.setItem(RELOADED_KEY, "1");
  } catch {
    // No sessionStorage (some private-mode configs): reload anyway. One
    // unguarded reload still beats a blank page; a loop needs the chunk to
    // keep failing, which is the rare broken-deploy case.
  }
  window.location.reload();
  return true;
}
