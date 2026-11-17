import type { ErrorComponentProps } from "@tanstack/react-router";
import { Component, useEffect, useMemo, type ErrorInfo, type ReactNode } from "react";
import posthog from "../lib/posthog";
import { captureClientException } from "../lib/sentry";
import {
  canReloadForNewVersion,
  dismissNewVersion,
  isChunkLoadError,
  reloadForNewVersion,
} from "../lib/new-version";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = { crashed: boolean; chunkError: boolean; giveUp: boolean };

function pendingReload(state: State): boolean {
  return state.crashed && state.chunkError && !state.giveUp;
}

/** Catches commit-phase throws, e.g. the browser page translator rewriting text nodes React
 * anchors on so a later `insertBefore` fails. A stale-chunk error renders nothing on
 * purpose: the reload is already underway. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, chunkError: false, giveUp: false };

  static getDerivedStateFromError(error: Error): State {
    return { crashed: true, chunkError: isChunkLoadError(error), giveUp: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // Stale tab after a deploy: reload onto the current build, showing nothing meanwhile.
      if (reloadForNewVersion(error.message)) return;
      // Reload budget spent: a genuinely broken deploy, worth reporting. Clear the banner
      // `vite:preloadError` queued so the notice is not a second copy of it.
      dismissNewVersion();
      this.setState({ giveUp: true });
    }
    posthog.captureException(error, { componentStack: info.componentStack });
    captureClientException(error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    // A recoverable chunk error paints nothing: the reload is already underway.
    if (pendingReload(this.state)) return null;
    return this.props.fallback !== undefined ? (
      this.props.fallback
    ) : (
      <FullPageError chunk={this.state.chunkError} />
    );
  }
}

/** StrictMode runs effects twice: this stops a second reload and a second report. */
const handledRouteErrors = new WeakSet<Error>();

/** The router catches route errors inside its own boundary, so ErrorBoundary never hears
 * of them (a stale chunk on Back or Forward, which lib/chunk-guard.ts cannot stop). */
export function RouteError({ error: thrown }: ErrorComponentProps) {
  const error = useMemo(
    () => (thrown instanceof Error ? thrown : new Error(String(thrown))),
    [thrown],
  );
  const chunk = isChunkLoadError(error);
  // Decided once per error, while drawing: the effect below spends a reload,
  // which would otherwise flip this answer before the browser navigates.
  const reloading = useMemo(() => chunk && canReloadForNewVersion(error.message), [chunk, error]);
  useEffect(() => {
    if (handledRouteErrors.has(error)) return;
    handledRouteErrors.add(error);
    if (reloading) {
      reloadForNewVersion(error.message);
      return;
    }
    // A chunk a reload cannot fix: the notice says so, so the queued banner would repeat it.
    if (chunk) dismissNewVersion();
    posthog.captureException(error);
    captureClientException(error);
  }, [error, chunk, reloading]);
  if (reloading) return null;
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
