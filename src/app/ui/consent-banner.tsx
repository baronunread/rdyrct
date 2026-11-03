import { Link } from "@tanstack/react-router";
import { Button } from "./button";
import { cn } from "./cn";
import { openConsentBanner, useConsentBannerVisible } from "../lib/consent";
import { grantAnalyticsConsent, revokeAnalyticsConsent } from "../lib/posthog";
import { RDYRCT_SITE } from "@/shared/site";

/** A self-hosted copy has no /privacy of its own: it links whatever policy
 *  its operator names, or none. */
const OPERATOR_PRIVACY_URL = import.meta.env.VITE_PRIVACY_URL;

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
      data-consent-banner
      className="fixed right-4 bottom-4 z-50 max-w-xs max-sm:left-4 max-sm:max-w-none rounded-xl bg-surface/95 p-4 text-xs text-muted smooth-shadow-ring-xl backdrop-blur"
    >
      <p className="leading-relaxed">
        A cookie keeps you signed in. With your consent we also use PostHog to see how rdyrct is
        used, including this visit. No advertising.
        <PrivacyLink />
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
    // A button that reads as a link: Tailwind v4 gives buttons the default
    // cursor, so the pointer has to be asked for.
    <button type="button" onClick={openConsentBanner} className={cn("cursor-pointer", className)}>
      Cookie settings
    </button>
  );
}

function PrivacyLink() {
  const className =
    "text-accent underline decoration-accent/40 underline-offset-2 [@media(hover:hover)]:hover:decoration-accent";
  if (RDYRCT_SITE) {
    return (
      <>
        {" "}
        <Link to="/privacy" hash="cookies" className={className}>
          Privacy policy
        </Link>
      </>
    );
  }
  if (!OPERATOR_PRIVACY_URL) return null;
  return (
    <>
      {" "}
      <a href={OPERATOR_PRIVACY_URL} className={className}>
        Privacy policy
      </a>
    </>
  );
}
