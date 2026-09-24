/**
 * The landing hero A/B test, run without consent.
 *
 * The variant is a coin flip made in this document and kept only in memory:
 * nothing is read from or written to the device and nothing is sent anywhere
 * to choose it, so choosing it needs no consent. What needs consent is
 * measuring it, and that rides on the funnel events, which already wait in
 * the pre-consent buffer until the visitor accepts (see consent-buffer.ts).
 * A reload flips the coin again; the test is measured per visit, not per
 * person.
 */
export type HeroVariant = "control" | "test";

let assigned: HeroVariant | null = null;

/** The variant for this document, flipping the coin on first use. Call it only
 *  where a signed-out visitor is actually shown the hero. */
export function heroVariant(): HeroVariant {
  assigned ??= Math.random() < 0.5 ? "control" : "test";
  return assigned;
}

/** The variant this document showed, or null if it showed none. */
export function shownHeroVariant(): HeroVariant | null {
  return assigned;
}
