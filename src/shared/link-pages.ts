/** Shared by the React views and the Worker fallback so they cannot drift. Neither page names the rule
 * that fired (it would teach the next scammer what to avoid), nor rdyrct: a customer's own domain shows them too. */
export const HELD_PAGE = {
  title: "Under review",
  heading: "This link is under review.",
  body: "We paused it while we check where it leads. Try again later.",
} as const;

export const DISABLED_PAGE = {
  title: "Link disabled",
  heading: "This link has been disabled.",
  // "Our" names nobody, so it reads right on a customer's own domain too.
  body: "The account that made this link was suspended for breaking our rules. You can close this page.",
} as const;

export const WARN_PAGE = {
  title: "Check this link",
  heading: "Check where this link goes.",
  lead: "We are still checking this link. It leads to",
  advice:
    "Continue only if you know and trust that site. Never type a password or card number into a page you did not expect.",
  action: "Continue",
} as const;

export const WARN_HOST_SLOT = "warn-host";
export const WARN_CONTINUE_SLOT = "warn-continue";

export const MADE_WITH_SLOT = "made-with";
