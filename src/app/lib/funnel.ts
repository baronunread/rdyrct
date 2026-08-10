/**
 * The landing-to-activation funnel (#64).
 *
 * One list, in order, so the funnel is something the codebase states rather
 * than something you reconstruct by grepping for capture() calls. PostHog's
 * funnel builder needs these names to be stable: renaming one silently breaks
 * the historical series, so treat them as an API.
 *
 * Measurement caveat, recorded here because it is easy to forget when reading
 * a dashboard: PostHog is off until the visitor accepts the consent banner
 * (see posthog.ts). Steps before that are buffered and flushed on Accept, and
 * nothing at all is recorded for a visitor who rejects. So these events count
 * *consenting* visitors. The honest denominator for the top of the funnel is
 * Cloudflare's own request count for the landing route, which needs no
 * consent because it is aggregate.
 */
export const FUNNEL = {
  /** 1. Landing page rendered. */
  landingViewed: "funnel_landing_viewed",
  /** 2. A call to action was clicked. `placement` says which one. */
  ctaClicked: "funnel_cta_clicked",
  /** 3. The pricing section scrolled into view. */
  pricingViewed: "funnel_pricing_viewed",
  /** 4. Signup form submitted and accepted. Already covered by
   *  `user_signed_up`; this is the funnel-shaped name for the same moment. */
  signupSubmitted: "funnel_signup_submitted",
  /** 5a. Verification code sent. */
  verificationSent: "funnel_verification_sent",
  /** 5b. Verification code accepted. */
  verificationCompleted: "funnel_verification_completed",
  /** 6. An organization was created. */
  orgCreated: "funnel_org_created",
  /** 7. A link was created. The activation event: a signed-up user with no
   *  link is not activated, so this is the end of the headline metric.
   *
   *  Both of these fire on every creation, not only the first. A funnel step
   *  counts a person once, at their first occurrence, so gating client-side
   *  would mean keeping "has this user created one before?" state in the
   *  browser to arrive at the same number. Only genuinely new links reach
   *  this: merging into an existing link goes through useAddressMutations. */
  linkCreated: "funnel_link_created",
} as const;

const FUNNEL_EVENTS: ReadonlySet<string> = new Set(Object.values(FUNNEL));

/** Buffer this event when it fires before the visitor has answered the
 *  consent banner. Only funnel steps are worth holding; a QR download by an
 *  unconsented visitor is not part of any funnel. */
export function isFunnelEvent(event: string): boolean {
  return FUNNEL_EVENTS.has(event);
}

/**
 * Where a CTA lives, so the hero, the pricing table and the closing block can
 * be told apart. #64 asks for exactly this: the hero click distinguished from
 * the secondary and from the final-CTA-section click.
 */
export type CtaPlacement =
  | "hero_primary"
  | "hero_secondary"
  | "header"
  | "pricing_free"
  | "pricing_hobby"
  | "pricing_pro"
  | "final_cta";

/**
 * A campaign tag is supposed to name a campaign, but the query string is
 * attacker- and mistake-controlled, and a link built by hand can easily carry
 * `utm_campaign=alice@example.com`. Anything outside a conservative shape is
 * dropped rather than truncated: a length cap does not make an email address
 * stop being one.
 */
const CAMPAIGN_SHAPE = /^[a-zA-Z0-9._\-+ ]{1,64}$/;

function safeCampaignValue(value: string): string | null {
  const trimmed = value.trim();
  if (!CAMPAIGN_SHAPE.test(trimmed)) return null;
  // "+" and "." are legal in campaign names and in the local part of an
  // address, so shape alone is not enough.
  if (trimmed.includes("@")) return null;
  return trimmed;
}

/**
 * Campaign attribution for the landing view, read from the URL and the
 * referrer.
 *
 * Referrer is reduced to its hostname. The full URL can carry a search query
 * or a private path, and storing referrer hostnames rather than URLs is
 * already the rule for click analytics (#20); the marketing funnel does not
 * get a weaker standard than the product does.
 */
export function landingContext(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const value = params.get(key);
      const safe = value && safeCampaignValue(value);
      if (safe) out[key] = safe;
    }
    if (document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (host && host !== window.location.hostname) out.referrer_host = host;
    }
  } catch {
    /* a malformed referrer or search string is not worth failing a pageview */
  }
  return out;
}
