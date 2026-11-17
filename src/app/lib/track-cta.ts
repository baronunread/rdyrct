// Its own module because funnel.ts has to stay a leaf: posthog.ts imports the consent
// buffer, which imports funnel.ts. A posthog import in funnel.ts closes a cycle among
// three modules that run at import time.
import posthog from "./posthog";
import { FUNNEL, type CtaPlacement } from "./funnel";

export function trackCta(placement: CtaPlacement) {
  posthog.capture(FUNNEL.ctaClicked, { placement });
}
