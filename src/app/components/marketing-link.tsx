// preload="intent" keeps the route load inside the navigation. A Suspense fallback would hide
// the outgoing page, collapse the document and make the browser clamp scroll to the top: a jump
// nothing can animate. resetScroll={false} leaves the new page something to scroll up from.
import type { MouseEventHandler } from "react";
import { Link, useNavigate, useRouter, type LinkProps } from "@tanstack/react-router";
import { armScrollUp, rideToTop } from "../lib/marketing-scroll";
import { isPlainLeftClick } from "../lib/plain-click";

// Module-level: two clicks on different links race. The commit also checks the location
// has not moved, which covers navigations that never bump this (Sign up, back button, redirect).
let latestClick = 0;

type Router = ReturnType<typeof useRouter>;
type Navigate = ReturnType<typeof useNavigate>;

function goWhenLoaded(router: Router, navigate: Navigate, to: LinkProps) {
  const from = router.state.location.href;

  // Same place: nothing to load, and navigate() would change no dep useMarketingScroll
  // watches, leaving the arm unspent for the next page.
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
      // Arm here, not on the click: a click that loses the race never arrives, and would
      // leave the next page riding to the top.
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
