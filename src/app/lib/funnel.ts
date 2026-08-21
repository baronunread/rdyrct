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
  // The hero's anonymous shortener (Direction A of #96): using it, and then
  // clicking through to keep the link that came out of it. The second is the
  // one worth watching, because it is intent earned by the product rather
  // than by the copy above it.
  | "hero_shortener"
  | "hero_shortener_claim"
  // The custom-domain second screen (Direction C of #96), the first paid
  // ask on the page.
  | "second_screen_domain"
  // The one ask in the long middle of the page, at the end of the analytics
  // preview. Worth its own placement: it fires right after somebody has been
  // shown the payoff, so it measures whether the mock actually sells.
  | "analytics_preview"
  // The standalone QR generator (Direction D of #96). The page asks nothing
  // of the visitor, so these two are the only intent it can report: taking
  // the free account, or going to read what the paid ones cost.
  | "qr_page_signup"
  | "qr_page_pricing"
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
const SAFE_CAMPAIGN_VALUE = /^[a-zA-Z0-9._\-+ ]{1,64}$/;

function safeCampaignValue(value: string): string | null {
  const trimmed = value.trim();
  if (!SAFE_CAMPAIGN_VALUE.test(trimmed)) return null;
  // "+" and "." are legal in campaign names and in the local part of an
  // address, so shape alone is not enough.
  if (trimmed.includes("@")) return null;
  return trimmed;
}

/** The campaign parameters a landing URL is read for. */
const CAMPAIGN_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

/** What a landing pageview carries about where the visitor came from. Every
 * field is optional: most visits offer none of them. */
type LandingContext = Partial<Record<(typeof CAMPAIGN_PARAMS)[number] | "referrer_host", string>>;

/**
 * Campaign attribution for the landing view, read from the URL and the
 * referrer.
 *
 * Referrer is reduced to its hostname. The full URL can carry a search query
 * or a private path, and storing referrer hostnames rather than URLs is
 * already the rule for click analytics (#20); the marketing funnel does not
 * get a weaker standard than the product does.
 */
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
  } catch {
    /* a malformed referrer or search string is not worth failing a pageview */
  }
  return out;
}
