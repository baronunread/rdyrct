import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { useSeo } from "../lib/seo";
import { useMarketingScroll } from "../lib/marketing-scroll";
import { useAudience } from "../lib/audience";
import { LandingHeader } from "./landing-header";
import { WebMcpMarketingTools } from "./webmcp-marketing-tools";
import { Footer } from "../ui/footer";
import { PageHero } from "./marketing-kit";

export function MarketingPage({
  path,
  title,
  intro,
  hero,
  children,
}: {
  path: string;
  title: string;
  intro: ReactNode;
  hero?: ReactNode;
  children: ReactNode;
}) {
  const { authed } = useAudience();
  useSeo(path);
  useMarketingScroll();

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="page-column">
          <WebMcpMarketingTools />
          <LandingHeader authed={authed} />

          <main>
            <PageHero title={title} intro={intro}>
              {hero}
            </PageHero>

            {children}
          </main>

          <Footer />
        </div>
      </LazyMotion>
    </MotionConfig>
  );
}
