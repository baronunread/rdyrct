# Rate limiting

rdyrct uses Cloudflare Workers Rate Limiting bindings as app-level abuse
controls. These counters are local to each Cloudflare location, permissive, and
eventually consistent. Do not use them for billing or exact plan limits.

## Worker policies

All policies use a 60-second window. Namespace IDs `14001` through `14008` are
reserved for rdyrct in the Cloudflare account.

| Binding              | Limit | Key                               | Protected work                                  |
| -------------------- | ----: | --------------------------------- | ----------------------------------------------- |
| `RL_AUTH_PUBLIC`     |    10 | Auth action + opaque client HMAC  | Sign-in, sign-up, verification                  |
| `RL_EMAIL`           |     3 | Email action + opaque client HMAC | Verification and password-reset email           |
| `RL_WRITE_FREE`      |    30 | User + org + route group          | Free-plan API writes                            |
| `RL_WRITE_PAID`      |   120 | User + org + route group          | Paid-plan API writes                            |
| `RL_QR_UPLOAD`       |     5 | User + org                        | R2 QR logo uploads                              |
| `RL_DOMAIN_SETUP`    |    12 | User + org                        | Domain reads and mutations that call Cloudflare |
| `RL_BILLING`         |     3 | User + billing action             | Polar checkout and portal sessions              |
| `RL_CLICK_RECORDING` |   600 | Organization                      | D1 click analytics writes                       |

API limits return HTTP `429`, `Retry-After: 60`, and the stable error code
`rate_limited`. Binding failures fail open for signed API work so a Cloudflare
counter outage does not take down the app. Click analytics fails closed because
the redirect does not depend on it.

The public client HMAC uses the request address as a transient input. The raw
input and HMAC never enter D1, KV, application logs, or click analytics.
Structured logs contain only the event, policy group, HTTP method, and plan.
Shared addresses may place several valid users in one public bucket, so tune
these limits from production evidence rather than treating them as exact.

## Monitoring

Cloudflare does not show Worker rate-limit binding counters in the dashboard.
Use **Workers & Pages → rdyrct → Observability → Logs** and filter for:

```text
"event":"rate_limited"
```

Group by `group` and `plan` when tuning limits. Alert on a sustained rise in
`rate_limit_error`, which means the binding failed and API protection opened.

The domain limit allows the app's 10-second activation poll plus manual actions.
Lowering it below 6 per minute will break the expected setup flow.

## WAF outer shield

Create a zone-level WAF rate-limiting rule for clear attack traffic. Keep this
separate from the Worker deployment because rule features and thresholds depend
on the zone plan.

Recommended starting rule:

- Name: `rdyrct public auth outer shield`
- Match: host equals `rdyrct.com`, method is `POST`, and path starts with
  `/api/auth/`
- Counting characteristic: source IP
- Start in log or managed-challenge mode when the plan supports it
- Initial threshold: 100 requests per 10 seconds
- Never include short-link redirect paths

Check the available counting periods, actions, and rule count in the zone
dashboard before enabling enforcement. Shared addresses can represent many
valid users, so review logs before lowering the threshold.

## Rollout and rollback

1. Deploy the Worker bindings and code with the documented limits.
2. Confirm `rate_limited` and `rate_limit_error` events in Worker logs.
3. Add the WAF rule in log or challenge mode, then monitor it before enforcing.
4. Tune one policy at a time. Worker counters may briefly exceed a configured
   limit by design.

To roll back, disable the WAF rule first and roll the Worker back to the prior
version. Keep namespace IDs reserved while an older Worker version may still
serve traffic. Removing a binding before rolling code back can cause runtime
errors.

## Cloudflare references

- [Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [WAF rate-limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
