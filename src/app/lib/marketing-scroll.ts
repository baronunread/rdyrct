// The page owns this, not the layout: the page's lazy chunk renders only once it is on the
// machine, the first honest signal the new page is on screen. The layout re-renders earlier.
// The content swaps first, keeping scroll position, then the new page rides up (as resend.com does).
import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";

// A timestamp, not a boolean, so a click that never arrives anywhere
// (a middle-click, a failed navigation) cannot make the next page ride to the top.
let armedAt = 0;
const ARM_WINDOW_MS = 3000;

export function armScrollUp() {
  armedAt = Date.now();
}

function rideDuration(distance: number) {
  return Math.min(1100, 400 + distance * 0.12);
}

function easeInOutQuart(t: number) {
  return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;
}

// Not `behavior: "smooth"`: the native curve is fixed and short. Every step passes "instant"
// because styles.css sets `scroll-behavior: smooth` site-wide. A wheel, touch or key cancels it.
export function rideToTop() {
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

  // Keyed on mount, not on the location: `useLocation` updates while the page being LEFT
  // is still on screen, so a location-keyed effect would ride the old page up.
  useEffect(() => {
    rideIfArmed();
  }, []);

  // A link to the page you are already on (the logo from "/#faq" goes to "/") remounts
  // nothing, so only the ride up is left. Guarded on the path being ours so the page
  // being left does not take this branch.
  useEffect(() => {
    if (pathname !== ownPath.current) return;
    rideIfArmed();
  }, [pathname, hash]);
}
