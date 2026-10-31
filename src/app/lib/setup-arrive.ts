/**
 * The navigation into the app from a sign-in card (the code screen, the
 * sign-in form, /welcome): the card shrinks into the org switcher, the logo
 * moves to the sidebar's corner, and the sheet rises around them. The parts
 * are named in styles.css under `setup-arrive`.
 *
 * Off where the browser cannot tell transition types apart: there the named
 * parts would also travel on every ordinary page change.
 */
export const SETUP_ARRIVE = globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))")
  ? { types: ["setup-arrive"] }
  : false;
