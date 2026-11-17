import { lazyRouteComponent, type AnyRouter, type HistoryLocation } from "@tanstack/react-router";
import { forgetBlockedTarget, isChunkLoadError, signalNewVersionAvailable } from "./new-version";

// Back and forward change the URL before a blocker hears of them, so a failed chunk there
// still falls to the error boundary's reload.

type Importer = () => Promise<object>;

// `lazyRouteComponent` swallows a failed load until render, too late.
const importers = new WeakMap<object, Importer>();

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: mirrors lazyRouteComponent's own constraint; M is a module namespace the compiler types.
export function lazyPage<M extends Record<string, any>, K extends keyof M>(
  importer: () => Promise<M>,
  exportName: K,
) {
  const component = lazyRouteComponent<M, K>(importer, exportName);
  importers.set(component, importer);
  return component;
}

// Later navigations queue behind this one, so a hanging request must not hold them all.
const CHECK_TIMEOUT_MS = 8_000;

// A failed import stays failed in the module map, so a second ask is instant.
async function missingChunk(loads: Promise<object>[]): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
  });
  const settled = Promise.all(loads).then(
    () => false,
    (error) => error instanceof Error && isChunkLoadError(error),
  );
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

export function guardStaleChunks(router: AnyRouter, extra: Record<string, Importer>) {
  const blocks = async (next: HistoryLocation, from: HistoryLocation): Promise<boolean> => {
    const loads = router.matchRoutes(router.parseLocation(next)).flatMap((match) => {
      const route = router.routesById[match.routeId];
      const component = route?.options.component;
      const own = component ? importers.get(component) : undefined;
      return [own, extra[match.routeId]].filter((load) => load !== undefined).map((load) => load());
    });
    if (loads.length && (await missingChunk(loads))) {
      signalNewVersionAvailable(next.href);
      return true;
    }
    // Another page opened: the banner may stay, but its reload is no longer
    // for the page an earlier blocked click was opening. A page rewriting its own
    // query string is not the visitor going anywhere.
    if (next.pathname !== from.pathname) forgetBlockedTarget();
    return false;
  };

  // Answers go out in the order navigations were asked for. Without the queue a
  // later navigation whose chunk came first would land first, then be overwritten.
  let previous = Promise.resolve();
  return router.history.block({
    // A blocker asks the browser to confirm leaving the site by default. This
    // one never stops anybody leaving.
    enableBeforeUnload: false,
    blockerFn: ({
      currentLocation,
      nextLocation,
      action,
    }: {
      currentLocation: HistoryLocation;
      nextLocation: HistoryLocation;
      action: string;
    }) => {
      if (action !== "PUSH" && action !== "REPLACE") return false;
      const answer = previous.then(() => blocks(nextLocation, currentLocation));
      previous = answer.then(
        () => {},
        () => {},
      );
      return answer;
    },
  });
}
