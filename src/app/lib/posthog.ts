import type { default as PosthogClient } from "posthog-js";
import type { JsonValue } from "@/shared/types";
import { bufferBeforeConsent, discardBuffer, drainBuffer } from "./consent-buffer";
import { CONSENT_KEY, onConsentLapse, readConsent, writeConsent } from "./consent";
import { posthogTokenForHost } from "./posthog-project";

// Nothing here loads posthog-js or contacts PostHog until the user accepts
// analytics in the consent banner: before that, calls are no-ops and the library
// is never downloaded.
function hasAnalyticsConsent(): boolean {
  return readConsent() === "accepted";
}

let clientPromise: Promise<typeof PosthogClient | null> | null = null;
export type EventProperties = Record<string, JsonValue | undefined>;

let pendingIdentity: { id: string; properties?: EventProperties } | null = null;
let identifiedId: string | null = null;
let identifiedProperties: EventProperties | undefined;

function identifyPendingUser(posthog: typeof PosthogClient | null) {
  if (!posthog || !pendingIdentity || pendingIdentity.id === identifiedId) return;
  const { id, properties } = pendingIdentity;
  pendingIdentity = null;
  identifiedId = id;
  identifiedProperties = properties;
  posthog.identify(id, properties);
}

function loadClient(): Promise<typeof PosthogClient | null> | null {
  if (!("window" in globalThis) || !hasAnalyticsConsent()) return null;
  if (!clientPromise) {
    clientPromise = import("posthog-js").then(({ default: posthog }) => {
      // SAFETY: Vite inlines every VITE_-prefixed variable as a string
      // literal at build time, or leaves it undefined when it is unset, which
      // is exactly what the check below is for.
      const productionToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN as
        | string
        | undefined;
      // SAFETY: Vite inlines this public project token as a string or undefined too.
      const developmentToken = import.meta.env.VITE_PUBLIC_POSTHOG_DEV_PROJECT_TOKEN as
        | string
        | undefined;
      const token = posthogTokenForHost(
        window.location.hostname,
        productionToken,
        developmentToken,
        import.meta.env.DEV,
      );
      // An unconfigured local project stays silent rather than falling back
      // to production. This also covers built previews, where DEV is false.
      if (!token) return null;
      // SAFETY: as above.
      const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined;
      const missingVariable = !token
        ? "VITE_PUBLIC_POSTHOG_PROJECT_TOKEN"
        : !host
          ? "VITE_PUBLIC_POSTHOG_HOST"
          : null;
      if (missingVariable) {
        if (import.meta.env.DEV) {
          throw new Error(
            `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
          );
        }
        return null;
      }
      posthog.init(token!, {
        api_host: host!,
        defaults: "2026-01-30",
        // The privacy policy promises no autocapture and no screen replay.
        // Each of these otherwise falls back to a project setting someone
        // can flip, so say so here instead.
        autocapture: false,
        disable_session_recording: true,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_performance: false,
        // Withdrawing consent then deletes PostHog's cookie and storage, not
        // just the right to send.
        opt_out_persistence_by_default: true,
        capture_exceptions: {
          capture_unhandled_errors: true,
          capture_unhandled_rejections: true,
        },
      });
      identifyPendingUser(posthog);
      // An answer given in another tab applies to this one too: the SDK
      // sends pageviews and errors on its own, not only through capture().
      window.addEventListener("storage", (event) => {
        if (event.key !== CONSENT_KEY) return;
        if (hasAnalyticsConsent()) resumeCapturing(posthog);
        else stopCapturing();
      });
      return posthog;
    });
  }
  return clientPromise;
}

export function resumeAnalyticsIfConsented() {
  void loadClient();
}

function consentUnanswered(): boolean {
  return readConsent() === null;
}

function flushPending(posthog: typeof PosthogClient | null) {
  if (!posthog) return;
  for (const { event, properties, at } of drainBuffer()) {
    posthog.capture(event, { ...properties, $capture_before_consent: true }, { timestamp: at });
  }
}

export function grantAnalyticsConsent() {
  writeConsent("accepted");
  void loadClient()?.then((posthog) => {
    resumeCapturing(posthog);
    flushPending(posthog);
  });
}

function resumeCapturing(posthog: typeof PosthogClient | null) {
  if (posthog?.has_opted_out_capturing()) posthog.opt_in_capturing();
  identifyPendingUser(posthog);
}

export function revokeAnalyticsConsent() {
  writeConsent("rejected");
  stopCapturing();
}

function stopCapturing() {
  discardBuffer();
  if (identifiedId) pendingIdentity ??= { id: identifiedId, properties: identifiedProperties };
  identifiedId = null;
  if (clientPromise) {
    void clientPromise.then((posthog) => posthog?.opt_out_capturing());
  } else {
    clearPostHogStorage();
  }
}

onConsentLapse(stopCapturing);

function clearPostHogStorage() {
  if (!("document" in globalThis)) return;
  const persisted = /^ph_.+_posthog$/;
  try {
    for (const key of Object.keys(localStorage)) {
      if (persisted.test(key)) localStorage.removeItem(key);
    }
  } catch {}
  const labels = location.hostname.split(".");
  const domains = labels.map((_, i) => labels.slice(i).join(".")).slice(0, -1);
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (!persisted.test(name)) continue;
    for (const domain of ["", ...domains.map((d) => `; domain=${d}`)]) {
      document.cookie = `${name}=; max-age=0; path=/${domain}`;
    }
  }
}

const posthog = {
  capture(event: string, properties?: EventProperties) {
    const client = loadClient();
    if (!client) {
      bufferBeforeConsent(event, properties, consentUnanswered());
      return;
    }
    void client.then((p) => p?.capture(event, properties));
  },
  identify(id: string, properties?: EventProperties) {
    if (identifiedId === id) return;
    pendingIdentity = { id, properties };
    void loadClient()?.then(identifyPendingUser);
  },
  reset() {
    pendingIdentity = null;
    identifiedId = null;
    void loadClient()?.then((p) => p?.reset());
  },
  captureException(cause: unknown, properties?: EventProperties) {
    void loadClient()?.then((p) => p?.captureException(cause, properties));
  },
};

export default posthog;
