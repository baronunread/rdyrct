import { createContext } from "react";

/**
 * The build's prerendered shell (scripts/prerender-app-shell.tsx) has no
 * user to draw, so where the org and the person go it leaves slots that
 * styles.css fills from CSS variables the head script in index.html sets
 * from the same cache, before the first paint. In the app, false.
 */
export const ShellSlots = createContext(false);
