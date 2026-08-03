import { useState } from "react";
import { Link } from "react-router";
import { Button } from "./button";
import { CONSENT_KEY, grantAnalyticsConsent, revokeAnalyticsConsent } from "../lib/posthog";

// The session cookie is strictly necessary and needs no consent, but
// PostHog is not: it stays off (nothing loads, nothing is sent) until the
// visitor picks "Accept". Reject is just as easy, and PostHog stays off.
export function ConsentBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(CONSENT_KEY) !== null;
    } catch {
      return true;
    }
  });
  if (dismissed) return null;
  const respond = (accepted: boolean) => {
    if (accepted) grantAnalyticsConsent();
    else revokeAnalyticsConsent();
    setDismissed(true);
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-xl bg-surface/95 p-4 text-xs text-muted smooth-shadow-ring-xl backdrop-blur">
      <p className="leading-relaxed">
        rdyrct uses a strictly-necessary cookie to keep you signed in. We'd also like to use PostHog
        to understand how the product is used, no advertising. See our{" "}
        <Link to="/privacy" className="text-accent hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => respond(false)}>
          Reject
        </Button>
        <Button size="sm" variant="primary" className="flex-1" onClick={() => respond(true)}>
          Accept
        </Button>
      </div>
    </div>
  );
}
