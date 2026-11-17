// Off where the browser cannot tell transition types apart: there the named
// parts would also travel on every ordinary page change.
// react-doctor-disable-next-line react-doctor/no-flush-sync -- it runs inside startViewTransition's update, which must leave the new DOM in place when it returns.
import { flushSync } from "react-dom";

export const SETUP_ARRIVE = globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))")
  ? { types: ["setup-arrive"] }
  : false;

function transition(type: string, update: () => void) {
  const run = () => flushSync(update);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!SETUP_ARRIVE || still || !document.startViewTransition) return run();
  document.startViewTransition({ update: run, types: [type] });
}

export const settleSetup = (update: () => void) => transition("setup-settle", update);

export const arriveInFlow = (update: () => void) => transition("setup-flow", update);

export const SETUP_FLOW = SETUP_ARRIVE ? { types: ["setup-flow"] } : false;

const APP_PAGE =
  /^\/(dashboard|analytics|links|import|members|billing|domains|settings|admin)(\/|\?|$)/;
export const isAppPage = (href: string) => APP_PAGE.test(href);
