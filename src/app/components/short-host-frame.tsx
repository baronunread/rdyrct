import type { ReactNode } from "react";
import { MADE_WITH_SLOT } from "@/shared/link-pages";
import { FrameRow } from "./marketing-kit";

/**
 * The page a short link answers with when it does not redirect: the 404
 * (NotFoundView), and the held and warning pages (link-state-views.tsx). It
 * wears the marketing frame (rdyrct-design, "Light on the marketing pages")
 * but names no brand, because a customer's domain shows it too.
 *
 * `madeWith` adds the one exception, a quiet link at the foot of the page
 * that the Worker keeps only on rdyrct.com's own hosts and strips everywhere
 * else. Pinned to the bottom edge, so the frame stays centred whether or not
 * the link survives.
 */
export function ShortHostFrame({
  children,
  madeWith = false,
}: {
  children: ReactNode;
  madeWith?: boolean;
}) {
  return (
    <div className="relative isolate grid min-h-dvh place-items-center overflow-hidden px-6 py-16">
      <div
        aria-hidden="true"
        className="landing-mesh absolute top-1/2 left-1/2 -z-10 h-96 w-160 max-w-full -translate-1/2 opacity-50"
      />
      <div className="w-full max-w-xl border-x border-border/70">
        <FrameRow className="bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[14px_14px] px-6 py-14 text-center sm:px-12 sm:py-16">
          {children}
        </FrameRow>
        <FrameRow />
      </div>
      {madeWith && (
        <a
          data-slot={MADE_WITH_SLOT}
          href="/"
          className="absolute inset-x-0 bottom-6 mx-auto w-fit py-2 text-xs text-muted hover:text-text"
        >
          Made with rdyrct
        </a>
      )}
    </div>
  );
}
