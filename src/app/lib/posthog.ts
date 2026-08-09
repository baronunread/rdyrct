import type { default as PosthogClient } from "posthog-js";
import { isFunnelEvent } from "./funnel";

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
let pendingIdentity: { id: string; properties?: Record<string, unknown> } | null = null;
let identifiedId: string | null = null;

function identifyPendingUser(posthog: typeof PosthogClient | null) {
  if (!posthog || !pendingIdentity || pendingIdentity.id === identifiedId) return;
  const { id, properties } = pendingIdentity;
  pendingIdentity = null;
  identifiedId = id;
  posthog.identify(id, properties);
}

function loadClient(): Promise<typeof PosthogClient | null> | null {
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return null;
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
 * Events that happened before the visitor answered the banner.
 *
 * The banner renders after the page does, so the landing view and any CTA
 * click that beats it would otherwise be lost, and those are the first two
 * steps of the funnel (#64). Held in memory only: nothing is written down and
 * nothing leaves the browser unless the visitor later picks Accept, at which
 * point the queue is sent with its original timestamps so the session reads
 * as one path instead of starting halfway through.
 *
 * Rejecting drops the queue on the floor. The cap is there so a long session
 * that never answers cannot grow without bound.
 */
const PENDING_LIMIT = 50;
let pending: { event: string; properties?: Record<string, unknown>; at: string }[] = [];

function queueBeforeConsent(event: string, properties?: Record<string, unknown>) {
  if (pending.length >= PENDING_LIMIT) return;
  pending.push({ event, properties, at: new Date().toISOString() });
}

function flushPending(posthog: typeof PosthogClient | null) {
  if (!posthog) return;
  const queued = pending;
  pending = [];
  for (const { event, properties, at } of queued) {
    posthog.capture(event, { ...properties, $capture_before_consent: true, timestamp: at });
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
  pending = [];
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
  capture(event: string, properties?: Record<string, unknown>) {
    const client = loadClient();
    // Null means no consent yet. Hold funnel steps so the path survives a
    // later Accept; everything else is dropped, as before.
    if (!client) {
      if (isFunnelEvent(event)) queueBeforeConsent(event, properties);
      return;
    }
    void client.then((p) => p?.capture(event, properties));
  },
  identify(id: string, properties?: Record<string, unknown>) {
    if (identifiedId === id) return;
    pendingIdentity = { id, properties };
    void loadClient()?.then(identifyPendingUser);
  },
  reset() {
    pendingIdentity = null;
    identifiedId = null;
    void loadClient()?.then((p) => p?.reset());
  },
  captureException(error: unknown, properties?: Record<string, unknown>) {
    void loadClient()?.then((p) => p?.captureException(error, properties));
  },
};

export default posthog;
