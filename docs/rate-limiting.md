# Rate limiting and bot protection

Three layers sit in front of this app, and they fail differently, which is
why all three exist.

| Layer                   | Where it runs                      | Counts                  | Catches                |
| ----------------------- | ---------------------------------- | ----------------------- | ---------------------- |
| WAF rate limiting rules | Cloudflare edge, before the Worker | Globally, per zone      | Floods                 |
| Workers Rate Limiting   | Inside the Worker                  | Per Cloudflare location | Bursts from one caller |
| Cloudflare Turnstile    | Visitor's browser                  | Per attempt             | Slow, distributed bots |

A rate limit is a ceiling. Turnstile is a gate. Neither replaces the other: a
bot that stays politely under every limit gets through a ceiling, and a flood
from ten thousand addresses meets a gate only if each attempt is challenged.

## Layer 1: WAF rate limiting rules (dashboard)

These are **not in this repo**. They live in the Cloudflare dashboard, which
is why they are written down here: invisible infrastructure is infrastructure
nobody can review.

They run before the Worker starts, so a blocked request costs no CPU time and
no billable invocation. Unlike the Workers limiters below, the counters are
global rather than per-location.

### What is live on production (set 2026-10-16)

Both zones are on the Cloudflare **Free** plan, which allows one rate limiting
rule per zone, counts over 10 seconds only, blocks for 10 seconds only, and
must count by IP and Cloudflare location (so the counters are per-location
there, not global). The two rules below do not fit, so production runs these
two instead:

| Zone         | Name             | Expression                                      | Limit              | Action               |
| ------------ | ---------------- | ----------------------------------------------- | ------------------ | -------------------- |
| `rdyrct.com` | `auth-endpoints` | `(http.request.uri.path contains "/api/auth/")` | 30 per 10 seconds  | Block for 10 seconds |
| `rdyr.cc`    | `redirect-flood` | `(http.host eq "rdyr.cc")`                      | 300 per 10 seconds | Block for 10 seconds |

`redirect-flood` is deliberately high. People share an address (mobile
carriers, offices, an event's Wi-Fi) and link preview bots fetch from a few
addresses, and a blocked visitor sees an error page instead of the
destination. It is there to stop a script, not a crowd.

`password-reset` below is **not deployed**: the Free plan has no slot for
it. The Worker limiters in Layer 2 cover that path. A Pro zone allows two
rules and blocks of up to an hour.

Add the full set at **Security → WAF → Rate limiting rules** on the `rdyrct.com` zone.
Both rules target auth paths, which only ever get hit on that zone
(the shared redirect host from `SHARED_LINK_HOST`, e.g. `rdyr.cc`, only ever
serves redirects), so there is nothing to add on its zone for these.

### Rule 1: authentication endpoints

| Field           | Value                                           |
| --------------- | ----------------------------------------------- |
| Name            | `auth-endpoints`                                |
| Expression      | `(http.request.uri.path contains "/api/auth/")` |
| Characteristics | IP                                              |
| Period          | 1 minute                                        |
| Requests        | 60                                              |
| Action          | Block                                           |
| Duration        | 10 minutes                                      |

Above the Worker's own 30/minute, deliberately, and counted across every
auth path at once. The Worker's counters are per-location and per-path, so a
caller spread across colos, or across the several paths one sign-up touches,
can go well past any single one. This catches that without punishing a person
whose corporate NAT shares an address: one sign-up costs a handful of
requests, so 60 is a bot and 20 was a family.

### Rule 2: password reset

| Field           | Value                                                           |
| --------------- | --------------------------------------------------------------- |
| Name            | `password-reset`                                                |
| Expression      | `(http.request.uri.path eq "/api/auth/request-password-reset")` |
| Characteristics | IP                                                              |
| Period          | 1 minute                                                        |
| Requests        | 5                                                               |
| Action          | Block                                                           |
| Duration        | 1 hour                                                          |

Tight, and it can afford to be: nobody legitimately asks for five reset
emails in a minute. This is the upstream fix for the symptom that forced the
per-recipient email cap in #50.

### Not enabled: Bot Fight Mode

Tempting, free, one click. Per Cloudflare's own documentation it cannot be
customised or skipped, not even by WAF custom rules, and it "may challenge
API or mobile app traffic". That collides with the public API in #74. Super
Bot Fight Mode is skippable but needs a Pro zone plan. Revisit once #74 has
a shape.

## Layer 2: Workers Rate Limiting (`wrangler.jsonc`)

Defined in `wrangler.jsonc` under `ratelimits`, applied in
`src/worker/rate-limit.ts`. Counters are permissive and local to each
Cloudflare location, so treat these as abuse controls, never as quota
enforcement.

These are the production numbers. The dev and test environments in
`wrangler.jsonc` deliberately run several of them looser (`RL_AUTH_PUBLIC`,
`RL_EMAIL`, `RL_EMAIL_RECIPIENT`), because the e2e suite signs up
dozens of times a minute from one address and rate limiting the test run
proves nothing about the feature.

| Binding              | Limit   | Keyed by          | Guards                        |
| -------------------- | ------- | ----------------- | ----------------------------- |
| `RL_AUTH_PUBLIC`     | 30/min  | IP, path          | `/api/auth/*`                 |
| `RL_EMAIL`           | 10/min  | IP, path          | Anything that sends mail      |
| `RL_EMAIL_RECIPIENT` | 4/min   | Recipient address | One inbox, many callers (#50) |
| `RL_WRITE_FREE`      | 90/min  | User              | Writes on a free plan         |
| `RL_WRITE_PAID`      | 300/min | User              | Writes on a paid plan         |
| `RL_QR_UPLOAD`       | 20/min  | User              | QR logo uploads to R2         |
| `RL_DOMAIN_SETUP`    | 30/min  | User              | Custom hostname calls         |
| `RL_BILLING`         | 10/min  | User              | Polar checkout                |
| `RL_CLICK_RECORDING` | 600/min | Organization      | Click ingestion               |

These are set for the person having trouble, not for the bot: someone who
mistypes a password, retries a signup or pastes six links in a row must never
meet a wall, because a wall reads as the product being broken. Only
`RL_EMAIL_RECIPIENT` stays tight, because it is the one that bounds what an
inbox can be made to receive however many callers aim at it. The real
ceilings are the WAF rules above and the Turnstile challenge on each attempt.

`period` accepts only 10 or 60, so every one of these caps a rate, not a
daily total. Closing that gap needs a durable counter; see the follow-up on
#50.

## Layer 3: Cloudflare Turnstile (#304)

Free, and run by Cloudflare. The visitor's browser loads the Turnstile script
from `challenges.cloudflare.com` and solves a challenge there, so Cloudflare
sees the visitor: this is the one third party that does, and only on the
forms below. The Worker never sees the challenge. It sends the token to
Cloudflare's `siteverify` and believes the answer, and `siteverify` burns
the token, so a replay fails with no state of ours.

**Where it applies.** Signup, password reset, the landing page shortener and
its UTM builder (`/api/shorten`), and the abuse report form
(`/api/reports`). Not login: a bot with correct credentials is not the
threat model, and it would tax every real visitor on every visit. Each form
renders the widget with its own `action`, and the Worker refuses a token
whose action is not the one it expects, so a token earned on one form cannot
open another. Cloudflare's test secrets never echo an action, so that one
check is skipped when our own configured secret is one of Cloudflare's
published test secrets. `siteverify`'s own say-so is never trusted for this.

**How it looks.** It does not, unless Cloudflare wants a click. The widget
is `interaction-only` and starts on the form's first keystroke; when
Cloudflare asks for a click, it shows itself in the corner of the page.

**Keys.** Create a widget at dash.cloudflare.com → Turnstile, with
`rdyrct.com` as its hostname. Set both keys as secrets, `TURNSTILE_SITE_KEY`
and `TURNSTILE_SECRET_KEY` (`prod.secrets.env.example`). The site key is
public, since `/api/config` hands it to the browser, but it is a secret
rather than a var in `wrangler.jsonc` so a fork does not inherit ours.

**Set both or neither, in one call.** Put both keys in `prod.secrets.env` and
run `bunx wrangler secret bulk prod.secrets.env` once, so no deploy ever sees
one without the other. With neither set the check is off and the browser
never loads Cloudflare's script: that is a self-hosted copy that leaves both
blank. With only one set the Worker treats Turnstile as misconfigured: it
serves no site key, refuses every guarded form, and logs
`turnstile_misconfigured`. A lone site key would render a widget whose token
nobody checks, and a lone secret would have no widget to produce a token;
either way a form that looks protected and is not is the worse failure.
Cloudflare publishes test keys that always pass; `.dev.vars.local.example`
and the e2e run use them.

**CSP.** `script-src` and `frame-src` allow
`https://challenges.cloudflare.com` only when the request host is `APP_HOST`
and both keys are set (`turnstileAllowed` in
`src/worker/security-headers.ts`). A custom domain, the shared link host and a
copy without the keys never allow it. Asserted in
`tests/e2e/production/csp.pw.ts`, `tests/worker/security-headers.worker.ts`
and `tests/worker/turnstile.worker.ts`.

**If Cloudflare is unreachable** `siteverify` fails closed: the guarded
forms are refused until it answers.

## Monitoring

Rate-limit rejections log as `rate_limited <group> <method>` and errors as
`rate_limit_error`. Watch them in the Cloudflare dashboard under Workers →
rdyrct → Logs, or in Sentry if `SENTRY_DSN` is set.

WAF rule activity appears under Security → Events, filtered by the rule name.

## Rolling back

**A WAF rule is blocking real people.** Set its action to Log rather than
deleting it, so the counters keep running and you can see what it would have
caught.

**Turnstile is blocking real people.** Unset `TURNSTILE_SECRET_KEY` and
`TURNSTILE_SITE_KEY` (`bunx wrangler secret delete`). The check disables
itself and every guarded form works as it did without it. No deploy needed.

**A Workers limiter is too tight.** Change the `limit` in `wrangler.jsonc`
and deploy. Keep the `namespace_id`: changing it resets every counter.
