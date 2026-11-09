// A code-split chunk failing to load almost always means a stale tab: a
// visitor has a tab open whose hashed asset filenames no longer exist after a
// deploy. When it fails in the background (`vite:preloadError`, the visitor
// still on a working page) or on a click (lib/chunk-guard.ts, which keeps the
// page they were on) we surface this "new version available" banner and let
// them reload when they choose. When it fails while rendering, the old UI is
// already gone, so the error boundary forces a reload instead
// (`reloadForNewVersion`), with nothing shown while that can still work. This
// store is the bridge between those non-React callers and the React banner.

const CHUNK_LOAD_ERROR =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load a dynamic application chunk|is not a valid javascript mime type/i;

/** Whether `error` is a code-split chunk that failed to load (each browser
 * words it its own way). A deleted chunk comes back as the SPA's HTML with a
 * 200, not a 404 (production/assets.pw.ts), which Safari reports as a MIME
 * type error rather than a failed fetch. */
export function isChunkLoadError(error: Error): boolean {
  return CHUNK_LOAD_ERROR.test(error.message);
}

let available = false;
/** The page a blocked click was opening, for the banner's reload to land on. */
let target: string | undefined;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** `href` is the page a blocked click was opening. A later signal with none
 * (Vite's `vite:preloadError` for the same chunk, which Safari fires after
 * the blocker has spoken) keeps it. */
export function signalNewVersionAvailable(href?: string) {
  const next = href ?? target;
  if (available && next === target) return;
  available = true;
  target = next;
  emit();
}

/** A later navigation went through: Reload is for the page on screen again.
 * The banner stays; only the target goes. */
export function forgetBlockedTarget() {
  target = undefined;
}

export function dismissNewVersion() {
  if (!available) return;
  available = false;
  target = undefined;
  emit();
}

export function subscribeNewVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNewVersion(): boolean {
  return available;
}

/** Loads the current build: at the page a blocked click was opening, or the
 * page on screen. */
export function reloadNow() {
  if (target) window.location.assign(target);
  else window.location.reload();
}

const RELOAD_COUNT_PREFIX = "rdyrct:chunk-reload-count:";

/** How many automatic reloads one failure gets before we give up and show the
 * notice. More than one: a route on `lazyRouteComponent` (the public pages)
 * may already have spent its own single built-in reload attempt before this
 * ever runs, and a route that hasn't gets a second chance too, in case the
 * first reload raced a deploy that was still landing. Small and bounded, so a
 * genuinely broken deploy still stops rather than reloading forever. */
const MAX_AUTO_RELOADS = 2;

/** Whether `reloadForNewVersion(key)` would still reload: the budget is not
 * spent and there is sessionStorage to count with. Reads only, so a render
 * can ask it. */
export function canReloadForNewVersion(key: string): boolean {
  try {
    return Number(sessionStorage.getItem(RELOAD_COUNT_PREFIX + key) ?? "0") < MAX_AUTO_RELOADS;
  } catch {
    return false;
  }
}

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
