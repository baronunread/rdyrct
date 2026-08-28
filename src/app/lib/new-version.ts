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

const RELOADED_PREFIX = "rdyrct:chunk-reloaded:";

/**
 * One forced reload onto the current build, for when a chunk failed while
 * rendering a route the visitor just navigated to: the old UI is already
 * gone, so a reload is the fix, not a banner over a blank page.
 *
 * `key` names the specific failure (the error message, which carries the
 * missing hashed chunk's name). The reload is latched per key in
 * sessionStorage, so a broken deploy that keeps 404ing the same chunk falls
 * through to the notice instead of looping, while the next deploy (new chunk
 * names, so new messages) still gets its own retry. Returns false when the
 * latch is already set, when TanStack Router already reloaded for this same
 * failure (`lazyRouteComponent` has its own one-shot reload), or when there's
 * no sessionStorage to latch with.
 */
export function reloadForNewVersion(key: string): boolean {
  const mine = RELOADED_PREFIX + key;
  try {
    if (sessionStorage.getItem(`tanstack_router_reload:${key}`)) return false;
    if (sessionStorage.getItem(mine)) return false;
    sessionStorage.setItem(mine, "1");
  } catch {
    // No sessionStorage to latch the reload with (some locked-down privacy
    // configs): show the notice instead, so a still-missing chunk can't loop.
    return false;
  }
  window.location.reload();
  return true;
}
