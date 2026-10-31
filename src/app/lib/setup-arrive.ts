/**
 * The navigation into the app from a sign-in card (the code screen, the
 * sign-in form, /welcome): the card shrinks into the org switcher, the logo
 * moves to the sidebar's corner, and the sheet rises around them. The parts
 * are named in styles.css under `setup-arrive`.
 *
 * Off where the browser cannot tell transition types apart: there the named
 * parts would also travel on every ordinary page change.
 */
import { flushSync } from "react-dom";

export const SETUP_ARRIVE = globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))")
  ? { types: ["setup-arrive"] }
  : false;

/**
 * The first-run page becoming the dashboard (`setup-settle` in styles.css):
 * the setup list slides from the middle of the page to the top of the
 * dashboard while the header and the numbers rise in around it, instead of
 * the page swapping its layout in one frame. Plain where types are not
 * supported, and under reduced motion.
 */
export function settleSetup(update: () => void) {
  const run = () => flushSync(update);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!SETUP_ARRIVE || still || !document.startViewTransition) return run();
  document.startViewTransition({ update: run, types: ["setup-settle"] });
}

/** The app pages a sign-in card can hand over to by becoming the org
 * switcher. Anything else (an invite, /welcome) has no switcher to become. */
const APP_PAGE =
  /^\/(dashboard|analytics|links|import|members|billing|domains|settings|admin)(\/|\?|$)/;
export const isAppPage = (href: string) => APP_PAGE.test(href);
