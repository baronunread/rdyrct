// A chunk failing to load is almost always a stale tab after a deploy. In the background
// or on a click it shows the banner; while rendering, the error boundary forces a reload.

const CHUNK_LOAD_ERROR =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load a dynamic application chunk|is not a valid javascript mime type/i;

// A deleted chunk comes back as the SPA's HTML with a 200 (production/assets.pw.ts),
// which Safari reports as a MIME type error.
export function isChunkLoadError(error: Error): boolean {
  return CHUNK_LOAD_ERROR.test(error.message);
}

let available = false;
let target: string | undefined;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

// A later signal with no `href` (Safari fires `vite:preloadError` after the blocker
// has spoken) keeps it.
export function signalNewVersionAvailable(href?: string) {
  const next = href ?? target;
  if (available && next === target) return;
  available = true;
  target = next;
  emit();
}

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

export function reloadNow() {
  if (target) window.location.assign(target);
  else window.location.reload();
}

const RELOAD_COUNT_PREFIX = "rdyrct:chunk-reload-count:";

// More than one: a `lazyRouteComponent` route may have spent its own reload, or the first
// reload raced a deploy still landing. Bounded, so a broken deploy stops.
const MAX_AUTO_RELOADS = 2;

export function canReloadForNewVersion(key: string): boolean {
  try {
    return Number(sessionStorage.getItem(RELOAD_COUNT_PREFIX + key) ?? "0") < MAX_AUTO_RELOADS;
  } catch {
    return false;
  }
}

// Attempts count per `key` in sessionStorage, so a broken deploy stops after `MAX_AUTO_RELOADS`
// while the next deploy (new chunk names, new messages) gets a fresh budget.
export function reloadForNewVersion(key: string): boolean {
  const countKey = RELOAD_COUNT_PREFIX + key;
  try {
    const attempts = Number(sessionStorage.getItem(countKey) ?? "0");
    if (attempts >= MAX_AUTO_RELOADS) return false;
    sessionStorage.setItem(countKey, String(attempts + 1));
  } catch {
    // No sessionStorage (some locked-down privacy configs): show the notice
    // instead, so a still-missing chunk can't loop.
    return false;
  }
  window.location.reload();
  return true;
}
