import { Component, type ErrorInfo, type ReactNode } from "react";
import posthog from "../lib/posthog";
import { captureClientException } from "../lib/sentry";
import { dismissNewVersion, reloadForNewVersion } from "../lib/new-version";

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
 * A failed code-split chunk load almost always means a stale build: a visitor
 * has a tab open whose hashed asset filenames no longer exist after a deploy.
 * It is recoverable by reloading onto the current build, so we prompt a reload
 * rather than render the crash page.
 */
const CHUNK_LOAD_ERROR =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to load a dynamic application chunk/i;

function isChunkLoadError(error: Error): boolean {
  return CHUNK_LOAD_ERROR.test(error.message);
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
      // automatically, so this is the one case that shows anything at all.
      // Clear the top banner the failed import queued via `vite:preloadError`
      // first, so the notice below isn't a second stacked copy of it.
      dismissNewVersion();
      this.setState({ giveUp: true });
      return;
    }
    // Anything else is the crash this boundary exists for, worth reporting.
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
