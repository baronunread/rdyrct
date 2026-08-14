/**
 * Every call to action on the landing page reports through here, so the
 * funnel sees one event with a placement rather than a dozen differently
 * named ones.
 *
 * Its own module, not part of funnel.ts, because funnel.ts has to stay a
 * leaf: posthog.ts imports the consent buffer, which imports funnel.ts to
 * decide what is worth holding. Putting a posthog import into funnel.ts
 * closed that into a cycle, and a cycle among three modules that all run at
 * import time is an initialization order bug waiting for the wrong bundler.
 */
import posthog from "./posthog";
import { FUNNEL, type CtaPlacement } from "./funnel";

export function trackCta(placement: CtaPlacement) {
  posthog.capture(FUNNEL.ctaClicked, { placement });
}
