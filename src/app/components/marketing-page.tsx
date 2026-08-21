/**
 * The shell every standalone marketing page wears: header, a centred title
 * and intro, the content, the footer.
 *
 * Extracted when /roadmap became the second page with exactly this opening
 * and fallow flagged the clone. It is not an abstraction reaching for a
 * third caller: the two that exist were the same twenty lines twice, and the
 * next one that drifts would drift in the part a visitor notices first.
 *
 * The landing page and the QR generator do not use it. Both open on
 * something other than a title (a working shortener, a working generator),
 * which is the whole point of those two pages.
 */
import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { useSeo } from "../lib/seo";
import { useMarketingScroll } from "../lib/marketing-scroll";
import { useAudience } from "../lib/audience";
import { LandingHeader } from "./landing-header";
import { Footer } from "../ui/footer";

export function MarketingPage({
  path,
  title,
  intro,
  children,
}: {
  /** Canonical path, for the head tags. Same string the route uses. */
  path: string;
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  const { authed } = useAudience();
  useSeo(path);
  useMarketingScroll();

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
          <LandingHeader authed={authed} />

          <div className="pt-14 pb-2 text-center sm:pt-20">
            <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted sm:text-base">{intro}</p>
          </div>

          {children}

          <Footer />
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
