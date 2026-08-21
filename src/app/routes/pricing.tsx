/**
 * Standalone pricing page. "rdyrct pricing" is a real search, and the table
 * used to answer it only from a scroll position on "/", which a result can't
 * deep-link into as cleanly as a page of its own. Reuses the landing page's
 * table rather than forking a second copy that could drift from the numbers
 * there; the homepage in turn only teases three prices and links here (see
 * PricingTeaser in landing.tsx), so the table itself exists in one place.
 *
 * No self-host section here on purpose, same call the codebase's own
 * SelfHostSection comment already makes about Dub: a buying page that leads
 * with "or pay us nothing" argues against itself. Self-hosting stays a
 * homepage trust signal and a GitHub link in the footer below, same as Dub
 * and Cal.com.
 */
import { MarketingPage } from "../components/marketing-page";
import { PricingSection } from "./landing";

// main.tsx names this export as a string, for lazyRouteComponent, which
// static analysis can't follow.
// fallow-ignore-next-line unused-export
export function PricingPage() {
  return (
    <MarketingPage
      path="/pricing"
      title="Simple pricing, start free"
      intro="Upgrade when you outgrow the free plan. No credit card required to start."
    >
      <PricingSection />
    </MarketingPage>
  );
}
