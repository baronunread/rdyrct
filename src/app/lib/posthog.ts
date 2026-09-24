import type { default as PosthogClient } from "posthog-js";
import type { JsonValue } from "@/shared/types";
import { bufferBeforeConsent, discardBuffer, drainBuffer } from "./consent-buffer";
import { CONSENT_KEY, onConsentLapse, readConsent, writeConsent } from "./consent";
import { isFunnelEvent } from "./funnel";
import { shownHeroVariant } from "./hero-variant";

// Nothing here loads posthog-js or contacts PostHog until the user accepts
// analytics in the consent banner (see consent-banner.tsx): before that,
// capture/identify/reset are no-ops and the library is never even
// downloaded, so anonymous visitors (landing page, login) pay nothing.
function hasAnalyticsConsent(): boolean {
  return readConsent() === "accepted";
}

let clientPromise: Promise<typeof PosthogClient | null> | null = null;
/** What rides along with an event: values that survive JSON, since that is
 * what leaves the browser. `undefined` is allowed so a caller can pass a
 * field it has not got without building the object twice. */
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
      const token = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN as string | undefined;
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
  return readConsent() === null;
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
  writeConsent("accepted");
  void loadClient()?.then((posthog) => {
    resumeCapturing(posthog);
    flushPending(posthog);
  });
}

function resumeCapturing(posthog: typeof PosthogClient | null) {
  // After an earlier withdrawal: the opt-out flag outlives the page, so this
  // runs on a later visit too, not only after "Cookie settings".
  if (posthog?.has_opted_out_capturing()) posthog.opt_in_capturing();
  identifyPendingUser(posthog);
}

export function revokeAnalyticsConsent() {
  writeConsent("rejected");
  stopCapturing();
}

/** Shared by Reject, a Reject in another tab, and the answer lapsing. */
function stopCapturing() {
  discardBuffer();
  // A later Accept in this page should identify the user again.
  if (identifiedId) pendingIdentity ??= { id: identifiedId, properties: identifiedProperties };
  identifiedId = null;
  if (clientPromise) {
    // opt_out_persistence_by_default makes this delete PostHog's cookie and
    // storage too, leaving only the opt-out flag. No reset(): it would mint a
    // fresh id and reload flags from PostHog after the refusal.
    void clientPromise.then((posthog) => posthog?.opt_out_capturing());
  } else {
    clearPostHogStorage();
  }
}

onConsentLapse(stopCapturing);

/** What an earlier Accept left behind when no client is loaded to remove it,
 *  e.g. a Reject after the six months lapsed. Cookies are expired on this
 *  host and on each parent domain, since PostHog sets them site-wide. */
function clearPostHogStorage() {
  if (!("document" in globalThis)) return;
  const persisted = /^ph_.+_posthog$/;
  try {
    for (const key of Object.keys(localStorage)) {
      if (persisted.test(key)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
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

/** Funnel steps from a document that showed the landing hero say which
 *  version it was, so the A/B test is read straight off the funnel. */
function withHeroVariant(event: string, properties?: EventProperties) {
  const variant = shownHeroVariant();
  if (!variant || !isFunnelEvent(event)) return properties;
  return { ...properties, hero_variant: variant };
}

const posthog = {
  capture(event: string, eventProperties?: EventProperties) {
    const properties = withHeroVariant(event, eventProperties);
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
