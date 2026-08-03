import type { default as PosthogClient } from "posthog-js";

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

let clientPromise: Promise<typeof PosthogClient> | null = null;

function loadClient(): Promise<typeof PosthogClient> | null {
  if (typeof window === "undefined" || !hasAnalyticsConsent()) return null;
  if (!clientPromise) {
    clientPromise = import("posthog-js").then(({ default: posthog }) => {
      const token = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN as string | undefined;
      const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined;
      if (!token || !host) {
        if (import.meta.env.DEV) {
          throw new Error(
            "VITE_PUBLIC_POSTHOG_PROJECT_TOKEN / VITE_PUBLIC_POSTHOG_HOST required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once both are configured",
          );
        }
        return posthog;
      }
      posthog.init(token, {
        api_host: host,
        defaults: "2026-01-30",
        // Only the explicit capture() calls sprinkled through the app count
        // as product analytics here: no autocapture of clicks/inputs (could
        // pick up form values), no session recording, and no profile for a
        // visitor until they sign in and get identified.
        autocapture: false,
        disable_session_recording: true,
        person_profiles: "identified_only",
        capture_exceptions: {
          capture_unhandled_errors: true,
          capture_unhandled_rejections: true,
        },
      });
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

export function grantAnalyticsConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, "accepted");
  } catch {
    /* ignore */
  }
  void loadClient();
}

export function revokeAnalyticsConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, "rejected");
  } catch {
    /* ignore */
  }
  if (clientPromise) {
    void clientPromise.then((posthog) => posthog.opt_out_capturing());
  }
}

const posthog = {
  capture(event: string, properties?: Record<string, unknown>) {
    void loadClient()?.then((p) => p.capture(event, properties));
  },
  identify(id: string, properties?: Record<string, unknown>) {
    void loadClient()?.then((p) => p.identify(id, properties));
  },
  reset() {
    void loadClient()?.then((p) => p.reset());
  },
};

export default posthog;
