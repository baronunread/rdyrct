/**
 * Where a marketing page lands when you arrive on it.
 *
 * Two jobs, both owned by the page itself rather than by the layout above
 * it: the page component lives in its own lazy chunk, so it only renders
 * once that chunk is on the machine, which makes it the first honest signal
 * that the new page is actually on screen. The layout (PublicPages in
 * main.tsx) re-renders far earlier, while the old page is still the one the
 * visitor can see.
 *
 * 1. A hash picks its own landing spot. A client-side route change doesn't
 *    scroll to a fragment the way a fresh document load does, because the
 *    section usually doesn't exist yet when the route change commits.
 *
 * 2. Otherwise, if a MarketingLink started this navigation from partway down
 *    a page, ride up to the top. Note the order, which is the whole trick and
 *    the thing resend.com does: the content swaps FIRST, in place, keeping
 *    the scroll position, and only then does the NEW page scroll up to its
 *    own top. Scrolling the old page up before navigating (the obvious way
 *    round) means dragging the visitor back through content they were done
 *    with, and then changing it under them at the end.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";

/**
 * Set by MarketingLink on the click, read by the page that click lands on.
 * A timestamp rather than a boolean so a click that never arrives anywhere
 * (a middle-click that opened a tab, a navigation that failed) can't leave
 * the next unrelated page riding to the top.
 */
let armedAt = 0;
const ARM_WINDOW_MS = 3000;

export function armScrollUp() {
  armedAt = Date.now();
}

/**
 * Long enough to read as travel rather than a jump, and it grows with the
 * distance so leaving the bottom of a long page doesn't become a blur. The
 * cap keeps the longest ride under what anyone will sit through.
 */
function rideDuration(distance: number) {
  return Math.min(1100, 400 + distance * 0.12);
}

/** Slow off the mark, quick through the middle, a long settle at the end. */
function easeInOutQuart(t: number) {
  return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;
}

/**
 * Animate the window to the top.
 *
 * Hand-rolled rather than `behavior: "smooth"` because the native curve is
 * fixed and short: several thousand pixels of it go past too fast to read.
 * Every step passes `behavior: "instant"`, since styles.css turns on
 * `scroll-behavior: smooth` site-wide and each frame would otherwise start
 * its own animation to the frame after it.
 *
 * The visitor can take it back: a wheel, a touch or a key cancels the ride
 * and leaves the page wherever they stopped it.
 */
function rideToTop() {
  const from = window.scrollY;
  if (from === 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  const duration = rideDuration(from);
  const startedAt = performance.now();
  let running = true;
  const stop = () => {
    running = false;
    for (const name of ["wheel", "touchstart", "keydown"]) {
      window.removeEventListener(name, stop);
    }
  };
  for (const name of ["wheel", "touchstart", "keydown"]) {
    window.addEventListener(name, stop, { passive: true });
  }

  const step = (now: number) => {
    if (!running) return;
    const t = Math.min(1, (now - startedAt) / duration);
    window.scrollTo({ top: Math.round(from * (1 - easeInOutQuart(t))), behavior: "instant" });
    if (t < 1) requestAnimationFrame(step);
    else stop();
  };
  requestAnimationFrame(step);
}

function rideIfArmed() {
  if (Date.now() - armedAt > ARM_WINDOW_MS) return;
  armedAt = 0;
  rideToTop();
}

export function useMarketingScroll() {
  const { pathname, hash } = useLocation();
  const ownPath = useRef(pathname);

  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
  }, [hash]);

  // Arriving from another page. Keyed on mount, not on the location:
  // `useLocation` updates while the page being LEFT is still the one on
  // screen, so a location-keyed effect here would ride the old page up. A
  // route change mounts a different page component, which is the moment the
  // new page is really visible.
  useEffect(() => {
    rideIfArmed();
  }, []);

  // The link that points at the page you are already on: the rdyrct logo
  // clicked from "/#faq" goes to "/", which is the same route, so nothing
  // remounts and the effect above never runs again. Nothing to swap here,
  // just the ride back up. Guarded on the path being ours so the page being
  // left doesn't take this branch when the pathname changes under it.
  useEffect(() => {
    if (pathname !== ownPath.current) return;
    rideIfArmed();
  }, [pathname, hash]);
}
