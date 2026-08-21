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
import { armScrollUp, rideToTop } from "../lib/marketing-scroll";
import { isPlainLeftClick } from "../lib/plain-click";

/**
 * Which click is still the live one.
 *
 * Because the commit waits for `preloadRoute`, two links clicked in quick
 * succession race: the first load can settle after the second has already
 * navigated, and would then send the visitor to the page they gave up on.
 * The counter is module-level on purpose, since the two clicks are usually
 * on two different links, and each one only finishes what it started if
 * nothing has been clicked since.
 *
 * The counter alone only settles races between two of these links, because
 * nothing else bumps it. So the commit also checks that the location has not
 * moved since the click, which covers everything that is not one of these:
 * the "Sign up" and "Log in" buttons in the same header, the FAQ hash link,
 * the browser's back button, a redirect. Without it, clicking Pricing on a
 * cold chunk and then Sign up dropped the visitor back on /pricing mid-form.
 */
let latestClick = 0;

type Router = ReturnType<typeof useRouter>;
type Navigate = ReturnType<typeof useNavigate>;

/**
 * Take the visitor to `to`, once the page is ready to be shown.
 *
 * Load first, commit second. `preload="intent"` has usually done the loading
 * already on hover or focus, in which case this resolves on the spot; doing
 * it again here is what makes it certain rather than likely, and a route that
 * is already loaded never pends.
 */
function goWhenLoaded(router: Router, navigate: Navigate, to: LinkProps) {
  const from = router.state.location.href;

  // A link to the exact place you already are has nothing to load and nothing
  // to swap. Riding straight up is the whole of it, and going through
  // navigate() would change no dep that useMarketingScroll watches, so the
  // arm would sit there unspent and be picked up by whatever page came next.
  if (router.buildLocation({ ...to }).href === from) {
    rideToTop();
    return;
  }

  const click = ++latestClick;
  void router
    .preloadRoute({ ...to })
    .catch(() => {})
    .finally(() => {
      if (click !== latestClick || router.state.location.href !== from) return;
      // Arm here, not on the click: a click that loses the race never arrives
      // anywhere, and would otherwise leave the next page it wasn't meant for
      // riding to the top.
      armScrollUp();
      void navigate({ ...to, resetScroll: false, viewTransition: true });
    });
}

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
        goWhenLoaded(router, navigate, to);
      }}
    >
      {children}
    </Link>
  );
}
