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
import { FaqJsonLd } from "../components/faq-json-ld";
import { PricingSection, faqs } from "./landing";

const pricingFaqs = faqs.slice(0, 2);

export function PricingPage() {
  const { authed } = useAudience();
  useSeo("/pricing");
  useScrollToHash();

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
          <FaqJsonLd faqs={pricingFaqs} />
          <LandingHeader authed={authed} />

          <div className="pt-14 pb-2 text-center sm:pt-20">
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Simple pricing, start free
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted sm:text-base">
              Upgrade when your links outgrow the plan, or self-host and never pay us a cent.
            </p>
          </div>

          <PricingSection />

          <div className="mx-auto flex max-w-3xl flex-col gap-3 py-16">
            {pricingFaqs.map(({ q, a }) => (
              <details
                key={q}
                className="group rounded-lg border border-border bg-surface px-4 open:border-accent/40"
              >
                <summary className="cursor-pointer list-none py-4 text-sm font-bold [&::-webkit-details-marker]:hidden">
                  {q}
                </summary>
                <p className="pb-4 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>

          <Footer />
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
