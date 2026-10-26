import type { ReactNode } from "react";
import { ShortHostFrame } from "./short-host-frame";

/**
 * The 404 screen, without the router, so the Worker can render the same
 * markup for rdyr.cc and custom domains (src/worker/not-found-page.tsx),
 * which never boot the app. `back` is the way out: a router link in the
 * app, a plain one there, nothing on a customer's own domain. Give it
 * `HOME_LINK` (not-found-home.ts) for its look.
 */
export function NotFoundView({ back }: { back?: ReactNode }) {
  return (
    <ShortHostFrame>
      <BrokenHop />
      <p
        aria-hidden="true"
        className="text-metal mt-6 text-7xl font-bold tracking-tighter sm:text-8xl"
      >
        404
      </p>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
        Nothing lives at this link.
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-pretty text-muted">
        Check it for a typo. If it is right, whoever made it has taken it down.
      </p>
      {back && <div className="mt-8">{back}</div>}
    </ShortHostFrame>
  );
}

/** The mark's hop with nowhere to land: the dot leaves, the arc runs out
 *  dashed, and the landing is an empty ring. */
function BrokenHop() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 44"
      className="mx-auto h-11 w-30 text-muted"
      fill="none"
      strokeLinecap="round"
    >
      <circle cx="10" cy="36" r="4" className="fill-accent" />
      <path d="M10 36 C 26 4, 62 0, 82 14" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M82 14 C 92 21, 99 27, 104 32"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="1 4.5"
      />
      <circle
        cx="110"
        cy="36"
        r="4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2 2.2"
      />
    </svg>
  );
}
