import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};
const yes = () => true;
const no = () => false;

/** False for the server render and the hydrating render, true after. What a
 *  prerendered page may read only from the browser (storage, the URL) waits
 *  for this, so the first client render matches the HTML it adopts. */
export const useHydrated = () => useSyncExternalStore(subscribeToNothing, yes, no);
