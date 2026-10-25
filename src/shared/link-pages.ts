/**
 * What the held and warning pages say (#344). The React views
 * (src/app/components/link-state-views.tsx) are baked into the build by
 * scripts/prerender-404.tsx, and the Worker serves a plain fallback when that
 * build is missing (dev, the worker tests). Both read the words from here so
 * they cannot drift.
 *
 * Neither page names the rule that put it there: a page that said "reported"
 * or "too much traffic" would teach the next scammer what to avoid. A
 * customer's own domain shows these pages too, so neither names rdyrct.
 */
export const HELD_PAGE = {
  title: "Under review",
  heading: "This link is under review.",
  body: "We paused it while we check where it leads. Try again later.",
} as const;

/** A link whose owner was banned: decided, not under review. It still names
 * no rule, for the same reason as above. */
export const DISABLED_PAGE = {
  title: "Link disabled",
  heading: "This link has been disabled.",
  body: "Its owner broke the rules of the service that made it. It no longer leads anywhere.",
} as const;

export const WARN_PAGE = {
  title: "Check this link",
  heading: "Check where this link goes.",
  lead: "We are still checking this link. It leads to",
  advice:
    "Continue only if you know and trust that site. Never type a password or card number into a page you did not expect.",
  action: "Continue",
} as const;

/** The markers the Worker fills in on the warning page. */
export const WARN_HOST_SLOT = "warn-host";
export const WARN_CONTINUE_SLOT = "warn-continue";
