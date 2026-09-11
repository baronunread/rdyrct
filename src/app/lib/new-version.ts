// A code-split chunk failing to load almost always means a stale tab: a
// visitor has a tab open whose hashed asset filenames no longer exist after a
// deploy. When it fails in the background (`vite:preloadError`, the visitor
// still on a working page) we surface this "new version available" banner and
// let them reload when they choose. When it fails while rendering a route
// they just navigated to, the old UI is already gone, so the error boundary
// forces a reload instead (`reloadForNewVersion`), with nothing shown while
// that can still work. This store is the bridge between the non-React
// `vite:preloadError` handler and the React banner.

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

const RELOAD_COUNT_PREFIX = "rdyrct:chunk-reload-count:";

/** How many automatic reloads one failure gets before we give up and show the
 * notice. More than one: a route on `lazyRouteComponent` (the public pages)
 * may already have spent its own single built-in reload attempt before this
 * ever runs, and a route that hasn't gets a second chance too, in case the
 * first reload raced a deploy that was still landing. Small and bounded, so a
 * genuinely broken deploy still stops rather than reloading forever. */
const MAX_AUTO_RELOADS = 2;

/**
 * A forced reload onto the current build, for when a chunk failed while
 * rendering a route the visitor just navigated to: the old UI is already
 * gone, so a reload is the fix, not a banner over a blank page.
 *
 * `key` names the specific failure (the error message, which carries the
 * missing hashed chunk's name). Attempts are counted per key in
 * sessionStorage, so a broken deploy that keeps 404ing the same chunk stops
 * after `MAX_AUTO_RELOADS` instead of looping, while the next deploy (new
 * chunk names, so new messages) gets its own budget. Returns false once that
 * budget is spent, or when there's no sessionStorage to count with.
 */
export function reloadForNewVersion(key: string): boolean {
  const countKey = RELOAD_COUNT_PREFIX + key;
  try {
    const attempts = Number(sessionStorage.getItem(countKey) ?? "0");
    if (attempts >= MAX_AUTO_RELOADS) return false;
    sessionStorage.setItem(countKey, String(attempts + 1));
  } catch {
    // No sessionStorage to count the attempt with (some locked-down privacy
    // configs): show the notice instead, so a still-missing chunk can't loop.
    return false;
  }
  window.location.reload();
  return true;
}
