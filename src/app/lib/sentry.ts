import * as Sentry from "@sentry/react";

// SAFETY: Vite exposes configured VITE_ variables as strings and leaves absent values undefined.
const dsn = import.meta.env.VITE_PUBLIC_SENTRY_DSN as string | undefined;
const CHUNK_RELOAD_KEY = "rdyrct:chunk-reload-at";
const CHUNK_RELOAD_WINDOW_MS = 30_000;

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

window.addEventListener("vite:preloadError", () => {
  const previous = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY));
  const recent = Number.isFinite(previous) && Date.now() - previous < CHUNK_RELOAD_WINDOW_MS;
  if (recent) return;

  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  captureClientException(new Error("Failed to load a dynamic application chunk"));
  void flushClientEvents().finally(() => window.location.reload());
});

export function captureClientException(error: Error, componentStack?: string | null) {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    scope.setTag("runtime", "browser");
    scope.setContext("react", { componentStack: componentStack ?? "" });
    Sentry.captureException(error);
  });
}

async function flushClientEvents(): Promise<void> {
  if (!dsn) return;
  await Sentry.flush(2_000);
}
