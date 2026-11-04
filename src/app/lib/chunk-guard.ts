import { lazyRouteComponent, type AnyRouter, type HistoryLocation } from "@tanstack/react-router";
import { isChunkLoadError, signalNewVersionAvailable } from "./new-version";

/**
 * Stops a click from breaking the app when the page it opens is gone.
 *
 * After a deploy, a tab that is still open asks for page chunks under the old
 * build's hashed names, which no longer exist. The router used to commit the
 * navigation first and find out while rendering: the page you were on was
 * already gone, so all that was left was a blank screen and a reload. This
 * blocker loads the next page's code before the URL changes instead. If that
 * fails, the navigation never happens, the page you were on stays, and the
 * "new version" banner offers a reload that opens the page you asked for.
 *
 * Only the router's own push and replace go through here. Back and forward
 * have already changed the URL by the time a blocker hears of them, so a
 * failure there still falls to the error boundary's reload.
 */

/** A chunk's import: a module namespace, or a loader's module. */
type Importer = () => Promise<object>;

/** Each page component's import, so the blocker can ask for the chunk itself:
 * `lazyRouteComponent` swallows a failed load until render, too late. */
const importers = new WeakMap<object, Importer>();

/** `lazyRouteComponent`, remembering the import for the blocker. The same
 * generics, so each route keeps its page's props. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: mirrors lazyRouteComponent's own constraint; M is a module namespace the compiler types.
export function lazyPage<M extends Record<string, any>, K extends keyof M>(
  importer: () => Promise<M>,
  exportName: K,
) {
  const component = lazyRouteComponent<M, K>(importer, exportName);
  importers.set(component, importer);
  return component;
}

/** A failed import stays failed in the browser's module map, so asking again
 * is instant and fails the same way: no network cost to a second click. */
async function missingChunk(loads: Promise<object>[]): Promise<boolean> {
  try {
    await Promise.all(loads);
    return false;
  } catch (error) {
    return error instanceof Error && isChunkLoadError(error);
  }
}

/**
 * Installs the blocker on `router`. `extra` names chunks a route needs beyond
 * its own component, by route id: the app shell, which every app page draws
 * inside, and the welcome page, which loads its own way.
 */
export function guardStaleChunks(router: AnyRouter, extra: Record<string, Importer>) {
  /** Whether to stop a navigation to `next`: only when its code is gone. */
  const blocks = async (next: HistoryLocation): Promise<boolean> => {
    const loads = router.matchRoutes(router.parseLocation(next)).flatMap((match) => {
      const route = router.routesById[match.routeId];
      const component = route?.options.component;
      const own = component ? importers.get(component) : undefined;
      return [own, extra[match.routeId]].filter((load) => load !== undefined).map((load) => load());
    });
    if (!loads.length || !(await missingChunk(loads))) return false;
    signalNewVersionAvailable(next.href);
    return true;
  };

  // Answers go out in the order the navigations were asked for. Each one waits
  // on a chunk, and without the queue a later navigation whose chunk came
  // first would land first, then be overwritten by the earlier one.
  let previous = Promise.resolve();
  return router.history.block({
    // A blocker asks the browser to confirm leaving the site by default. This
    // one never stops anybody leaving.
    enableBeforeUnload: false,
    blockerFn: ({ nextLocation, action }: { nextLocation: HistoryLocation; action: string }) => {
      if (action !== "PUSH" && action !== "REPLACE") return false;
      const answer = previous.then(() => blocks(nextLocation));
      previous = answer.then(
        () => {},
        () => {},
      );
      return answer;
    },
  });
}
