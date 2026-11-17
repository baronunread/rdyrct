// Event names must stay stable: PostHog's funnel builder silently breaks the
// historical series on a rename. Only consenting visitors are counted (see posthog.ts),
// so Cloudflare's own request count is the true top of the funnel.
export const FUNNEL = {
  landingViewed: "funnel_landing_viewed",
  ctaClicked: "funnel_cta_clicked",
  pricingViewed: "funnel_pricing_viewed",
  signupViewed: "funnel_signup_viewed",
  signupStarted: "funnel_signup_started",
  signupSubmitted: "funnel_signup_submitted",
  verificationSent: "funnel_verification_sent",
  verificationCompleted: "funnel_verification_completed",
  orgCreated: "funnel_org_created",
  // Fires on every creation, not only the first: a funnel counts a person once,
  // at their first occurrence, so gating client-side would need browser state.
  linkCreated: "funnel_link_created",
} as const;

// Fired from the same call site as `verificationCompleted` and buffered with it, or a
// visitor who has not answered the consent banner drops this one and signups are undercounted.
export const USER_SIGNED_UP = "user_signed_up";

export const SIGNUP_FAILED = "signup_failed";

// Appended by the server's redirect after a Google sign-in creates the account
// (newUserCallbackURL): that signup never passes the form or code screen.
const GOOGLE_SIGNUP_PARAM = "signup";

const FUNNEL_EVENTS: ReadonlySet<string> = new Set([
  ...Object.values(FUNNEL),
  USER_SIGNED_UP,
  SIGNUP_FAILED,
]);

// Only a session token proves the new account is usable without an OTP.
export function captureEmailSignup(
  capture: (event: string, props: { method: string }) => void,
  signup: { token?: string | null } | null,
) {
  capture(FUNNEL.signupSubmitted, { method: "email" });
  if (signup?.token) capture(USER_SIGNED_UP, { method: "email" });
}

export function googleSignupUrl(next: string): string {
  const url = new URL(next, window.location.origin);
  url.searchParams.set(GOOGLE_SIGNUP_PARAM, "google");
  return url.pathname + url.search + url.hash;
}

export function captureGoogleSignup(capture: (event: string, props: { method: string }) => void) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(GOOGLE_SIGNUP_PARAM) !== "google") return;
  url.searchParams.delete(GOOGLE_SIGNUP_PARAM);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  capture(FUNNEL.signupSubmitted, { method: "google" });
  capture(USER_SIGNED_UP, { method: "google" });
}

export function isFunnelEvent(event: string): boolean {
  return FUNNEL_EVENTS.has(event);
}

export type CtaPlacement =
  | "hero_primary"
  | "hero_shortener"
  | "hero_shortener_claim"
  | "hero_shortener_signup"
  | "second_screen_domain"
  | "anon_link_bar"
  | "analytics_preview"
  | "qr_pillar"
  | "qr_page_signup"
  | "qr_page_pricing"
  | "header"
  | "alternative_page_signup"
  | "utm_page_shorten"
  | "utm_page_signup"
  | "utm_page_bulk_copy"
  | "utm_page_bulk_csv"
  | "utm_page_template"
  | "branded_page_signup"
  | "googl_page_signup"
  | "pricing_free"
  | "pricing_hobby"
  | "pricing_pro"
  | "final_cta";

// The query string is attacker- and mistake-controlled (`utm_campaign=alice@example.com`):
// anything outside a conservative shape is dropped, since truncating does not
// stop an email address being one.
const SAFE_CAMPAIGN_VALUE = /^[a-zA-Z0-9._\-+ ]{1,64}$/;

function safeCampaignValue(value: string): string | null {
  const trimmed = value.trim();
  if (!SAFE_CAMPAIGN_VALUE.test(trimmed)) return null;
  // "+" and "." are legal in campaign names and in the local part of an
  // address, so shape alone is not enough.
  if (trimmed.includes("@")) return null;
  return trimmed;
}

const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

type LandingContext = Partial<Record<(typeof CAMPAIGN_PARAMS)[number] | "referrer_host", string>>;

// Referrer is reduced to its hostname: the full URL can carry a search query
// or a private path (#20).
export function landingContext() {
  const out: LandingContext = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of CAMPAIGN_PARAMS) {
      const value = params.get(key);
      const safe = value && safeCampaignValue(value);
      if (safe) out[key] = safe;
    }
    if (document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (host && host !== window.location.hostname) out.referrer_host = host;
    }
  } catch {}
  return out;
}
