/**
 * A link between marketing pages: the content swaps where you are, then the
 * new page rides up to its top. Same move resend.com makes from its header
 * and footer links.
 *
 * Three props carry it, and none of them is the scrolling:
 *
 * - `preload="intent"`: fetch the page's chunk on hover or focus. The routes
 *   these point at are `lazyRouteComponent`s (main.tsx), which the router
 *   loads as part of the navigation rather than through Suspense, so the
 *   swap is one step with no empty frame in between. That matters more than
 *   it sounds: a Suspense fallback hides the outgoing page with
 *   `display: none`, the document collapses to one viewport, and the browser
 *   clamps the scroll to the top on the spot. That clamp is a hard jump
 *   nothing in our code can animate or prevent. This is the same prefetch a
 *   Next.js `<Link>` does, which is how resend.com avoids the same trap.
 *
 * - `resetScroll={false}`: the router's default jumps to the top as part of
 *   the navigation, which leaves nothing for the new page to scroll up from.
 *
 * - `armScrollUp()`: tells the page this click lands on to ride up once it
 *   is really on screen. The page owns that, because the page is the only
 *   thing here that renders at the right moment (lib/marketing-scroll.ts).
 *
 * A link with a hash is aiming at a section, so it arms nothing.
 */
import type { MouseEventHandler } from "react";
import { Link, useNavigate, useRouter, type LinkProps } from "@tanstack/react-router";
import { armScrollUp } from "../lib/marketing-scroll";
import { isPlainLeftClick } from "../lib/plain-click";

export function MarketingLink({
  children,
  className,
  onClick,
  ...to
}: LinkProps & { className?: string; onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <Link
      {...to}
      viewTransition
      preload="intent"
      resetScroll={false}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (to.hash || !isPlainLeftClick(event)) return;
        event.preventDefault();
        armScrollUp();
        // Load first, commit second. `preload="intent"` above has usually
        // done this already on hover or focus, in which case this resolves
        // on the spot; doing it again here is what makes it certain rather
        // than likely, and a route that is already loaded never pends.
        void router
          .preloadRoute({ ...to })
          .catch(() => {})
          .finally(() => void navigate({ ...to, resetScroll: false, viewTransition: true }));
      }}
    >
      {children}
    </Link>
  );
}
