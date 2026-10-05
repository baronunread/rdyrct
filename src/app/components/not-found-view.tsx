import type { ReactNode } from "react";

/**
 * The 404 screen, without the router, so the Worker can render the same
 * markup for rdyr.cc and custom domains (src/worker/not-found-page.tsx),
 * which never boot the app. `back` is the way out: a router link in the
 * app, a plain one there, nothing on a customer's own domain.
 */
export function NotFoundView({ back }: { back?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-4xl font-bold text-accent">404</p>
        <p className="mt-2 text-sm text-muted">
          This short link does not exist (or the page moved).
        </p>
        {back && <p className="mt-4 text-sm">{back}</p>}
      </div>
    </div>
  );
}
