import { Component, type ErrorInfo, type ReactNode } from "react";
import posthog from "../lib/posthog";
import { captureClientException } from "../lib/sentry";
import { signalNewVersionAvailable } from "../lib/new-version";

type Props = {
  children: ReactNode;
  /** Shown in place of the crashed subtree. Defaults to a full-page notice. */
  fallback?: ReactNode;
};

type State = { crashed: boolean; chunkError: boolean };

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
 * notice instead of a blank page. React reports commit-phase throws here (for
 * example when something outside React, like the browser's page translator,
 * rewrites text nodes React uses as placement anchors and a later
 * `insertBefore` fails). Without a boundary above the router, that throw would
 * unmount the whole app and a visitor would see nothing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, chunkError: false };

  static getDerivedStateFromError(error: Error): State {
    return { crashed: true, chunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // A stale tab after a deploy: surface the "new version available"
      // banner and let the visitor reload. The app can't render the failed
      // chunk, so we stay blank behind the banner rather than flash the
      // crash notice.
      signalNewVersionAvailable();
      return;
    }
    posthog.captureException(error, { componentStack: info.componentStack });
    captureClientException(error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    // A chunk-load failure renders blank behind the banner; everything else
    // gets the crash notice.
    if (this.state.chunkError) return null;
    return <FullPageError />;
  }
}

function FullPageError() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">
        <h1 className="text-lg font-bold">Something broke on this page.</h1>
        <p className="text-sm text-muted">Reload to try again.</p>
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
