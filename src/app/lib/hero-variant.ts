/** The landing hero assignment, stored only while analytics consent is valid. */
import { readConsent } from "./consent";

export type HeroVariant = "control" | "test";

const KEY = "rdyrct:hero-variant:v1";
let assigned: HeroVariant | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeHeroVariant(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function heroVariantSnapshot(): HeroVariant {
  return assigned ?? "control";
}

/** Assign once after consent and keep the same hero across reloads. */
export function heroVariant(): HeroVariant {
  if (readConsent() !== "accepted") return "control";
  if (assigned) return assigned;

  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "control" || stored === "test") {
      assigned = stored;
      notify();
      return assigned;
    }
  } catch {
    // Storage can be unavailable even after consent. This visit still gets a
    // valid assignment, but it cannot be kept for the next one.
  }

  assigned = Math.random() < 0.5 ? "control" : "test";
  try {
    localStorage.setItem(KEY, assigned);
  } catch {
    // Keep the assignment for this visit when storage is unavailable.
  }
  notify();
  return assigned;
}

/** The variant this document showed, or null if it showed none. */
export function shownHeroVariant(): HeroVariant | null {
  return assigned;
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
