/**
 * The landing hero copy test, stored only while analytics consent is valid.
 *
 * Two headings over the same hero: "own" ("Turn long links into your own.")
 * is the control, "answers" ("The link shortener that answers to you.") the
 * challenger. Decided on signups. index.html's inline script picks the arm
 * before paint for a consenting browser, so the prerendered page shows the
 * right heading with no flash; this module is the same coin for the rest of
 * the visit.
 *
 * v2: the key of the earlier layout test (v1) meant a different experiment,
 * so an arm stored under it is dropped, never reused.
 */
import { CONSENT_KEY, readConsent } from "./consent";

export type HeroVariant = "own" | "answers";

const KEY = "rdyrct:hero-variant:v2";
const isVariant = (value: string | null): value is HeroVariant =>
  value === "own" || value === "answers";
let assigned: HeroVariant | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeHeroVariant(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The arm to draw: the assigned one, else the one stored for a browser that
 *  has consented. Read-only, so the hero is already right on the first render
 *  and does not flip to control until the session resolves and assigns it. */
export function heroVariantSnapshot(): HeroVariant {
  if (assigned) return assigned;
  try {
    if (readConsent() === "accepted" && localStorage.getItem(KEY) === "answers") return "answers";
  } catch {
    // Storage can be unavailable; the control hero is the safe default.
  }
  return "own";
}

/** Assign once after consent and keep the same hero across reloads. */
export function heroVariant(): HeroVariant {
  if (readConsent() !== "accepted") return "own";
  if (assigned) return assigned;

  try {
    const stored = localStorage.getItem(KEY);
    if (isVariant(stored)) {
      assigned = stored;
      notify();
      return assigned;
    }
  } catch {
    // Storage can be unavailable even after consent. This visit still gets a
    // valid assignment, but it cannot be kept for the next one.
  }

  assigned = Math.random() < 0.5 ? "own" : "answers";
  try {
    localStorage.setItem(KEY, assigned);
  } catch {
    // Keep the assignment for this visit when storage is unavailable.
  }
  notify();
  return assigned;
}

/** The arm shown on this visit, including before a reload or OAuth return.
 * Reading attribution must never assign an arm to a direct signup visitor. */
export function shownHeroVariant(restore = false): HeroVariant | null {
  if (readConsent() !== "accepted") return null;
  if (assigned || !restore) return assigned;
  try {
    const stored = localStorage.getItem(KEY);
    return isVariant(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Keep the arm in step with consent and the session: forget it when consent
 * is refused, and flip the coin once an anonymous visitor's consent and
 * session have both answered. A signed-in visitor never flips it.
 */
export function syncHeroVariant(state: {
  consentReady: boolean;
  consented: boolean;
  sessionReady: boolean;
  authed: boolean;
}) {
  if (!state.consentReady) return;
  if (!state.consented) return clearHeroVariant();
  if (state.sessionReady && !state.authed) heroVariant();
}

/** Remove the assignment when consent is withdrawn or expires. */
export function clearHeroVariant() {
  if (assigned === null) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
    return;
  }
  assigned = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
  notify();
}

if ("window" in globalThis) {
  globalThis.window.addEventListener("storage", (event) => {
    if (event.key === CONSENT_KEY && readConsent() !== "accepted") clearHeroVariant();
  });
}
