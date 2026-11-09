import type { ErrorComponentProps } from "@tanstack/react-router";
import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import posthog from "../lib/posthog";
import { captureClientException } from "../lib/sentry";
import { dismissNewVersion, isChunkLoadError, reloadForNewVersion } from "../lib/new-version";

type Props = {
  children: ReactNode;
  /** Shown in place of the crashed subtree. Defaults to a full-page notice. */
  fallback?: ReactNode;
};

type State = { crashed: boolean; chunkError: boolean; giveUp: boolean };

/** Whether a recoverable chunk error is still pending its automatic reload:
 * the one case render() shows nothing for. Pulled out of render() so the
 * component's own branching stays flat. */
function pendingReload(state: State): boolean {
  return state.crashed && state.chunkError && !state.giveUp;
}

/**
 * Catches render/commit-phase exceptions so one broken subtree degrades to a
 * notice instead of taking the whole app down. React reports commit-phase
 * throws here (for example when something outside React, like the browser's
 * page translator, rewrites text nodes React uses as placement anchors and a
 * later `insertBefore` fails). Without a boundary above the router, that
 * throw would unmount the whole app and a visitor would see nothing.
 *
 * A stale-chunk error is the one case that does render nothing on purpose:
 * it is recoverable by reloading, so a visitor who hits it mid-deploy sees no
 * message at all, just the reload already underway. The notice below is only
 * for a crash reloading cannot fix.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, chunkError: false, giveUp: false };

  static getDerivedStateFromError(error: Error): State {
    return { crashed: true, chunkError: isChunkLoadError(error), giveUp: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // A stale tab after a deploy: the route the visitor navigated to can't
      // render, so reload onto the current build. That fixes it and lands
      // them where they were going, with nothing shown in between (see
      // render(): a chunk error paints nothing while this can still work).
      if (reloadForNewVersion(error.message)) return;
      // Reload couldn't fix it (see reloadForNewVersion's own budget): a
      // genuinely broken deploy, not a stale tab. Nothing left to try
      // automatically, so this is the one case that shows anything at all,
      // and worth reporting -- the terminal fallback showing is itself the
      // symptom of a broken deploy nobody would otherwise hear about. Clear
      // the top banner the failed import queued via `vite:preloadError`
      // first, so the notice below isn't a second stacked copy of it.
      dismissNewVersion();
      this.setState({ giveUp: true });
    }
    // Everything reaching here is worth reporting: either the crash this
    // boundary exists for, or a chunk error that ran out of reload budget.
    posthog.captureException(error, { componentStack: info.componentStack });
    captureClientException(error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    // A recoverable chunk error paints nothing: the reload is already
    // underway (or about to be attempted in componentDidCatch), and there is
    // nothing true to tell the visitor for the instant before the browser
    // navigates. The notice only appears once componentDidCatch has decided
    // reloading will not help.
    if (pendingReload(this.state)) return null;
    return this.props.fallback !== undefined ? (
      this.props.fallback
    ) : (
      <FullPageError chunk={this.state.chunkError} />
    );
  }
}

/** Route errors already handled, so StrictMode's second effect run neither
 * spends a second reload nor reports the error twice. */
const handledRouteErrors = new WeakSet<Error>();

/**
 * The router's error component for every route. The router catches a
 * route's error itself, inside an outer boundary of its own, so ErrorBoundary
 * never hears of it and the visitor got the router's "Something went wrong!"
 * with the raw import error. That is how a stale chunk met on Back or Forward
 * (which lib/chunk-guard.ts cannot stop) ended. This does what ErrorBoundary
 * does: a stale chunk reloads onto the current build with nothing shown, and
 * anything else, or a chunk reloading cannot fix, gets the full-page notice
 * and a report.
 */
export function RouteError({ error: thrown }: ErrorComponentProps) {
  // The router types what a route threw as unknown: anything can be thrown.
  const error = useMemo(
    () => (thrown instanceof Error ? thrown : new Error(String(thrown))),
    [thrown],
  );
  const chunk = isChunkLoadError(error);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (handledRouteErrors.has(error)) return;
    handledRouteErrors.add(error);
    if (chunk) {
      if (reloadForNewVersion(error.message)) return;
      dismissNewVersion();
      setGaveUp(true);
    }
    posthog.captureException(error);
    captureClientException(error);
  }, [error, chunk]);
  if (chunk && !gaveUp) return null;
  return <FullPageError chunk={chunk} />;
}

function FullPageError({ chunk }: { chunk?: boolean }) {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">
        <h1 className="text-lg font-bold">
          {chunk ? "A new version is available." : "Something broke on this page."}
        </h1>
        <p className="text-sm text-muted">
          {chunk ? "Reload to get the latest version." : "Reload to try again."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-accent px-3.5 text-sm font-bold text-bg transition duration-150 hover:brightness-110 active:brightness-95"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
