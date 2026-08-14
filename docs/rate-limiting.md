# Rate limiting and bot protection

Three layers sit in front of this app, and they fail differently, which is
why all three exist.

| Layer                   | Where it runs                      | Counts                  | Catches                |
| ----------------------- | ---------------------------------- | ----------------------- | ---------------------- |
| WAF rate limiting rules | Cloudflare edge, before the Worker | Globally, per zone      | Floods                 |
| Workers Rate Limiting   | Inside the Worker                  | Per Cloudflare location | Bursts from one caller |
| Cap proof-of-work       | Visitor's browser                  | Per attempt             | Slow, distributed bots |

A rate limit is a ceiling. Cap is a price. Neither replaces the other: a bot
that stays politely under every limit pays nothing to a ceiling, and a flood
from ten thousand addresses pays little to a price.

## Layer 1: WAF rate limiting rules (dashboard)

These are **not in this repo**. They live in the Cloudflare dashboard, which
is why they are written down here: invisible infrastructure is infrastructure
nobody can review.

They run before the Worker starts, so a blocked request costs no CPU time and
no billable invocation. Unlike the Workers limiters below, the counters are
global rather than per-location.

Add them at **Security → WAF → Rate limiting rules** on the `rdyrct.com` zone.

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

### Rule 2: proof-of-work challenges

| Field           | Value                                          |
| --------------- | ---------------------------------------------- |
| Name            | `cap-challenges`                               |
| Expression      | `(http.request.uri.path contains "/api/cap/")` |
| Characteristics | IP                                             |
| Period          | 1 minute                                       |
| Requests        | 60                                             |
| Action          | Managed challenge                              |
| Duration        | 1 minute                                       |

Higher, because issuing a challenge is cheap for us and expensive for the
caller, which is the whole asymmetry Cap rests on. The point is only to stop
someone farming challenges to solve offline in bulk.

### Rule 3: password reset

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
`RL_CAP`, `RL_EMAIL`, `RL_EMAIL_RECIPIENT`), because the e2e suite signs up
dozens of times a minute from one address and rate limiting the test run
proves nothing about the feature.

| Binding              | Limit   | Keyed by          | Guards                        |
| -------------------- | ------- | ----------------- | ----------------------------- |
| `RL_AUTH_PUBLIC`     | 30/min  | IP, path          | `/api/auth/*`                 |
| `RL_CAP`             | 120/min | IP, path          | `/api/cap/*` (#98)            |
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
meet a wall, because a wall reads as the product being broken. `RL_CAP` is the
clearest case: one sign-up spends a challenge and a redeem, its retry spends
two more, and when that budget runs out the browser cannot solve the puzzle at
all, so the form says "could not verify you are human" instead of "wait a
minute". It has its own generous counter for that reason. Only
`RL_EMAIL_RECIPIENT` stays tight, because it is the one that bounds what an
inbox can be made to receive however many callers aim at it. The real
ceilings are the WAF rules above and the CPU Cap charges per attempt.

`period` accepts only 10 or 60, so every one of these caps a rate, not a
daily total. Closing that gap needs a durable counter; see the follow-up on
#50.

## Layer 3: Cap proof-of-work (#98)

Self-hosted, Apache 2.0, and no third party ever sees the visitor. The
challenge is issued by our Worker, solved in the visitor's browser, and
verified by our Worker.

**Where it applies.** Signup and password-reset requests. Not login: a bot
with correct credentials is not the threat model, and it would tax every real
visitor on every visit.

**How it looks.** It does not. The widget is created off-screen and driven
directly, and solving starts on the form's first keystroke, so the work
overlaps the typing. Nobody ticks a box.

**The secret.** `CAP_SECRET`, from `openssl rand -hex 32`. With it unset the
check is skipped entirely, which is what keeps local dev quiet. capjs-core
refuses a secret under 16 bytes by throwing, so a too-short one takes signup
down rather than running unprotected: fail-closed, which for a security
control is the right way round, but worth knowing before you paste something
short.

**What it costs a visitor.** 12 challenges at difficulty 3, measured on a
laptop: about 25ms with the WASM solver, about 130ms without. The WASM path
needs `'wasm-unsafe-eval'` in `script-src`, which permits WebAssembly
compilation and nothing else, and the module is a same-origin Vite asset.
Cap's solver also runs in a Web Worker built from a `blob:` URL, hence
`worker-src 'self' blob:`. Both are asserted in
`tests/e2e/production/csp.pw.ts`, because a blocked solver fails silently:
signup would look fine and be completely unprotected.

**What it does not do.** KV is eventually consistent, so a redeemed token
presented to two locations at once has a small replay window. That is an
acceptable ceiling for a captcha, whose job is to price bulk attempts rather
than to guarantee exactly-once. Making it airtight would mean a Durable
Object per nonce, which costs more than the replay is worth.

## Monitoring

Rate-limit rejections log as `rate_limited <group> <method>` and errors as
`rate_limit_error`. Watch them in the Cloudflare dashboard under Workers →
rdyrct → Logs, or in Better Stack if `BETTERSTACK_INGEST_URL` is set.

WAF rule activity appears under Security → Events, filtered by the rule name.

## Rolling back

**A WAF rule is blocking real people.** Set its action to Log rather than
deleting it, so the counters keep running and you can see what it would have
caught.

**Cap is blocking real people.** Unset `CAP_SECRET`
(`bunx wrangler secret delete CAP_SECRET`). The check disables itself and
both guarded flows, signup and password reset, return to exactly their
previous behaviour. No deploy needed.

**A Workers limiter is too tight.** Change the `limit` in `wrangler.jsonc`
and deploy. Keep the `namespace_id`: changing it resets every counter.
