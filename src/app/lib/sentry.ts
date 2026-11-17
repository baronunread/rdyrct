import * as Sentry from "@sentry/react";
import { signalNewVersionAvailable } from "./new-version";

// SAFETY: Vite exposes configured VITE_ variables as strings and leaves absent values undefined.
const dsn = import.meta.env.VITE_PUBLIC_SENTRY_DSN as string | undefined;

// Operational telemetry, not product analytics: no replays, tracing, cookies or personal
// data. The DSN is public by design: it cannot read the project's data.
if (dsn) {
  Sentry.init({
    dsn,
    defaultIntegrations: false,
    // Sentry 11 collects every category by default; turn each one off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend(event) {
      if (event.request?.url) {
        const url = new URL(event.request.url);
        event.request.url = `${url.origin}${url.pathname}`;
      }
      return event;
    },
  });

  if (globalThis.window) {
    globalThis.window.addEventListener("error", (event) => {
      captureClientException(event.error instanceof Error ? event.error : new Error(event.message));
    });

    globalThis.window.addEventListener("unhandledrejection", (event) => {
      captureClientException(
        event.reason instanceof Error ? event.reason : new Error("Unhandled promise rejection"),
      );
    });
  }
}

// Not reported to Sentry: a stale tab is not a bug, and a broken deploy
// will surface real errors elsewhere.
if (globalThis.window) {
  globalThis.window.addEventListener("vite:preloadError", () => {
    signalNewVersionAvailable();
  });
}

export function captureClientException(error: Error, componentStack?: string | null) {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    scope.setTag("runtime", "browser");
    scope.setContext("react", { componentStack: componentStack ?? "" });
    Sentry.captureException(error);
  });
}
