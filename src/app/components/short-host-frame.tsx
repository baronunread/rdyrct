import type { ReactNode } from "react";
import { MADE_WITH_SLOT } from "@/shared/link-pages";
import { FrameRow } from "./marketing-kit";

// Names no brand, because a customer's domain shows this page too.
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
