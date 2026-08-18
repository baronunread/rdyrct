import type { ReactNode } from "react";
import { LandingHeader } from "./landing-header";
import { Footer } from "../ui/footer";

/**
 * Shared shell for the legal pages (privacy, terms).
 *
 * Its own file, not part of ui/misc.tsx: that file is the general UI kit
 * every authenticated app page pulls from, and this pulls in LandingHeader
 * (theme toggle, trackCta, morphicons), which none of those pages render.
 * Keeping it here keeps that cost off the dashboard's chunks.
 *
 * Two widths, not one. The page shell matches the landing page and the QR
 * generator so the footer's rule and links come out the same length on
 * every public page; the prose keeps its own narrower measure inside it,
 * which is what the outer max-w-3xl used to be for. Sharing one width made
 * the footer 720 here against 976 there, and the seam showed when somebody
 * followed a footer link.
 *
 * The real header, not a bare logo: these pages used to be a dead end with
 * no way back to Pricing or the QR generator except the browser's back
 * button, and they sat outside the marketing pages' shared header and
 * view-transition treatment (see landing-header.tsx) for no reason other
 * than having been built before it existed.
 */
export function LegalPageLayout({ children, authed }: { children: ReactNode; authed: boolean }) {
  return (
    <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
      <LandingHeader authed={authed} />
      <div className="mx-auto max-w-3xl py-12">
        <div className="flex flex-col gap-8 text-sm">{children}</div>
      </div>
      <Footer />
    </div>
  );
}
