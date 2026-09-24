import { Link } from "@tanstack/react-router";
import { Button } from "./button";
import { openConsentBanner, useConsentBannerVisible } from "../lib/consent";
import { grantAnalyticsConsent, revokeAnalyticsConsent } from "../lib/posthog";

// The session cookie is strictly necessary and needs no consent, but
// PostHog is not: it stays off (nothing loads, nothing is sent) until the
// visitor picks "Accept". Reject is just as easy, and PostHog stays off.
// "Cookie settings" brings this back, so either answer can be changed later.
export function ConsentBanner() {
  const visible = useConsentBannerVisible();
  if (!visible) return null;
  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed bottom-4 right-4 z-50 max-w-xs rounded-xl bg-surface/95 p-4 text-xs text-muted smooth-shadow-ring-xl backdrop-blur"
    >
      <p className="leading-relaxed">
        rdyrct uses a strictly-necessary cookie to keep you signed in. We'd also like to use PostHog
        to understand how the product is used, no advertising. If you accept, what you did on this
        page so far is sent too. See our{" "}
        <Link to="/privacy" className="text-accent hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={revokeAnalyticsConsent}>
          Reject
        </Button>
        {/* Same variant on purpose: the Garante and the EDPB treat a bright
            Accept next to a muted Reject as steering the answer. */}
        <Button size="sm" variant="outline" className="flex-1" onClick={grantAnalyticsConsent}>
          Accept
        </Button>
      </div>
    </div>
  );
}

/** Reopens the banner, to withdraw or give consent after the first answer. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openConsentBanner} className={className}>
      Cookie settings
    </button>
  );
}
