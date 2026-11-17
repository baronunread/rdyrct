import type { ReactNode } from "react";
import { LandingHeader } from "./landing-header";
import { Footer } from "../ui/footer";
import { PageHero } from "./marketing-kit";

/** Its own file, not ui/misc.tsx: this pulls in LandingHeader, which app pages never render,
 * and keeping it apart keeps that cost off their chunks. */
export function LegalPageLayout({
  children,
  authed,
  title,
  intro,
}: {
  children: ReactNode;
  authed: boolean;
  title: string;
  intro: ReactNode;
}) {
  return (
    <div className="page-column">
      <LandingHeader authed={authed} />
      <main>
        <PageHero title={title} intro={intro} />
        <div className="mx-auto flex max-w-3xl flex-col gap-8 py-12 text-sm">{children}</div>
      </main>
      <Footer />
    </div>
  );
}
