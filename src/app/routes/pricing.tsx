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
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { useSeo } from "../lib/seo";
import { useScrollToHash } from "../lib/scroll-to-hash";
import { useAudience } from "../lib/audience";
import { LandingHeader } from "../components/landing-header";
import { Footer } from "../ui/footer";
import { PricingSection } from "./landing";

export function PricingPage() {
  const { authed } = useAudience();
  useSeo("/pricing");
  useScrollToHash();

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
          <LandingHeader authed={authed} />

          <div className="pt-14 pb-2 text-center sm:pt-20">
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Simple pricing, start free
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted sm:text-base">
              Upgrade when your links outgrow the plan. No credit card required to start.
            </p>
          </div>

          <PricingSection />

          <Footer />
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
