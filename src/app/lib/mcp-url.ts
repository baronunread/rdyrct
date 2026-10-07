import { useSyncExternalStore } from "react";

const APP_ORIGIN = "https://rdyrct.com";
const getClientOrigin = () => window.location.origin;
// The prerender build has no window, so it uses the product origin. During
// hydration the Worker may have rewritten the static endpoint for a self-hosted
// origin, so the browser snapshot must match that request origin exactly.
const getServerOrigin = () => {
  return globalThis.window?.location.origin ?? APP_ORIGIN;
};
const subscribe = () => () => {};

export function mcpUrl(origin: string): string {
  return new URL("/api/mcp", origin).toString();
}

/** Keep SSR and hydration identical, then switch to this instance's origin. */
export function useMcpUrl(): string {
  const origin = useSyncExternalStore(subscribe, getClientOrigin, getServerOrigin);
  return mcpUrl(origin);
}
