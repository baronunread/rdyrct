import { HELD_PAGE, WARN_CONTINUE_SLOT, WARN_HOST_SLOT, WARN_PAGE } from "@/shared/link-pages";
import { HOME_LINK } from "./not-found-home";
import { ShortHostFrame } from "./short-host-frame";

/**
 * The two pages a short link answers with instead of redirecting (#344),
 * baked into the build by scripts/prerender-404.tsx and served by the Worker
 * (src/worker/link-state-page.ts). Never rendered by the app itself: they
 * show on rdyr.cc and on customers' own domains, which never boot it.
 */

/** A held link: suspended by an admin or by an automatic check. */
export function HeldView() {
  return (
    <ShortHostFrame>
      <PausedHop />
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
        {HELD_PAGE.heading}
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-pretty text-muted">{HELD_PAGE.body}</p>
    </ShortHostFrame>
  );
}

/**
 * A link with a warning: it still works, one click later. The Worker writes
 * the destination's host into the host slot and its URL into the button, so
 * the visitor reads where they are going before they go.
 */
export function WarnView() {
  return (
    <ShortHostFrame>
      <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
        {WARN_PAGE.heading}
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-pretty text-muted">{WARN_PAGE.lead}</p>
      <p
        data-slot={WARN_HOST_SLOT}
        className="mx-auto mt-4 max-w-full rounded-lg border border-border bg-surface px-4 py-3 font-mono text-base font-bold break-all"
      >
        example.com
      </p>
      <p className="mx-auto mt-4 max-w-sm text-sm text-pretty text-muted">{WARN_PAGE.advice}</p>
      <div className="mt-8">
        <a data-slot={WARN_CONTINUE_SLOT} href="/" rel="noreferrer" className={HOME_LINK}>
          {WARN_PAGE.action}
        </a>
      </div>
    </ShortHostFrame>
  );
}

/** The mark's hop, stopped: the dot leaves, the arc runs, and where the
 *  landing dot would be there is a pause sign. */
function PausedHop() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 44"
      className="mx-auto h-11 w-30 text-muted"
      fill="none"
      strokeLinecap="round"
    >
      <circle cx="10" cy="36" r="4" className="fill-accent" />
      <path d="M10 36 C 26 4, 62 0, 88 18" stroke="currentColor" strokeWidth="1.5" />
      <path d="M103 26 V 42" stroke="currentColor" strokeWidth="3" />
      <path d="M112 26 V 42" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}
