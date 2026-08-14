import type { default as PosthogClient } from "posthog-js";
import type { JsonValue } from "@/shared/types";
import { bufferBeforeConsent, discardBuffer, drainBuffer } from "./consent-buffer";

// Nothing here loads posthog-js or contacts PostHog until the user accepts
// analytics in the consent banner (see consent-banner.tsx): before that,
// capture/identify/reset are no-ops and the library is never even
// downloaded, so anonymous visitors (landing page, login) pay nothing.
export const CONSENT_KEY = "rdyrct:consent:v2";

function hasAnalyticsConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

let clientPromise: Promise<typeof PosthogClient | null> | null = null;
/** What rides along with an event: values that survive JSON, since that is
 * what leaves the browser. `undefined` is allowed so a caller can pass a
 * field it has not got without building the object twice. */
export type EventProperties = Record<string, JsonValue | undefined>;

let pendingIdentity: { id: string; properties?: EventProperties } | null = null;
let identifiedId: string | null = null;

function identifyPendingUser(posthog: typeof PosthogClient | null) {
  if (!posthog || !pendingIdentity || pendingIdentity.id === identifiedId) return;
  const { id, properties } = pendingIdentity;
  pendingIdentity = null;
  identifiedId = id;
  posthog.identify(id, properties);
}

function loadClient(): Promise<typeof PosthogClient | null> | null {
  if (!("window" in globalThis) || !hasAnalyticsConsent()) return null;
  if (!clientPromise) {
    clientPromise = import("posthog-js").then(({ default: posthog }) => {
      const token = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN as string | undefined;
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
        capture_exceptions: {
          capture_unhandled_errors: true,
          capture_unhandled_rejections: true,
        },
      });
      identifyPendingUser(posthog);
      return posthog;
    });
  }
  return clientPromise;
}

/** Call once at app start: resumes analytics for a returning visitor who
 * already consented, without waiting for a capture() call to trigger it
 * (so e.g. pageviews are tracked from the first navigation). No-ops, and
 * loads nothing, if consent hasn't been granted. */
export function resumeAnalyticsIfConsented() {
  void loadClient();
}

/**
 * The banner renders after the page does, so the landing view and any CTA
 * click that beats it would otherwise be lost, and those are the first two
 * steps of the funnel (#64). See consent-buffer.ts for the rules; this file
 * only decides when to ask it and how to replay it.
 */
function consentUnanswered(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === null;
  } catch {
    return false;
  }
}

function flushPending(posthog: typeof PosthogClient | null) {
  if (!posthog) return;
  for (const { event, properties, at } of drainBuffer()) {
    // `timestamp` belongs in the third argument. Passing it as a property
    // leaves the SDK stamping the flush time, which would collapse the whole
    // pre-consent path onto the moment the banner was answered.
    posthog.capture(event, { ...properties, $capture_before_consent: true }, { timestamp: at });
  }
}

export function grantAnalyticsConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, "accepted");
  } catch {
    /* ignore */
  }
  void loadClient()?.then(flushPending);
}

export function revokeAnalyticsConsent() {
  discardBuffer();
  try {
    localStorage.setItem(CONSENT_KEY, "rejected");
  } catch {
    /* ignore */
  }
  if (clientPromise) {
    void clientPromise.then((posthog) => posthog?.opt_out_capturing());
  }
}

const posthog = {
  capture(event: string, properties?: EventProperties) {
    const client = loadClient();
    // Null means no consent yet. Hold funnel steps so the path survives a
    // later Accept; everything else is dropped, as before.
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
