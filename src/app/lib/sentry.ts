import * as Sentry from "@sentry/react";

// SAFETY: Vite exposes configured VITE_ variables as strings and leaves absent values undefined.
const dsn = import.meta.env.VITE_PUBLIC_SENTRY_DSN as string | undefined;

// Error reports are operational telemetry, not product analytics: do not add
// replays, tracing, cookies, or personal data. The DSN is deliberately public
// because browsers need it to send events; it only identifies this Sentry
// project and cannot read its data.
if (dsn) {
  Sentry.init({
    dsn,
    defaultIntegrations: false,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.url) {
        const url = new URL(event.request.url);
        event.request.url = `${url.origin}${url.pathname}`;
      }
      return event;
    },
  });

  window.addEventListener("error", (event) => {
    captureClientException(event.error instanceof Error ? event.error : new Error(event.message));
  });

  window.addEventListener("unhandledrejection", (event) => {
    captureClientException(
      event.reason instanceof Error ? event.reason : new Error("Unhandled promise rejection"),
    );
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
