# Deployments

Deploy releases gradually. rdyrct serves content-hashed Vite assets, so a
browser that has an older page open must keep reaching the older Worker version
while it fetches that page's lazy chunks.

## Cloudflare setup

Create these Request Header Transform Rules for `rdyrct.com`, in this order.
They set `Cloudflare-Workers-Version-Key`, which makes Cloudflare keep each
visitor on one Worker version during a gradual rollout.

1. **Signed-in session**
   - Expression: `http.cookie contains "__Secure-better-auth.session_token"`
   - Header name: `Cloudflare-Workers-Version-Key`
   - Operation: Set dynamic
   - Value: `http.request.cookies["__Secure-better-auth.session_token"][0]`
2. **Anonymous visitor**
   - Expression: `not http.cookie contains "__Secure-better-auth.session_token"`
   - Header name: `Cloudflare-Workers-Version-Key`
   - Operation: Set dynamic
   - Value: `ip.src`

Better Auth uses the `__Secure-better-auth.session_token` cookie in production.
The anonymous fallback follows Cloudflare's recommendation for visitors without
a stable application identifier. Transform Rules run on the zone, so this setup
also covers static asset requests that bypass the Worker.

## Release workflow

1. Run `bun run deploy`. It builds the app and uploads a Worker version without
   publishing it.
2. Run `bun run deploy:promote`. Select the uploaded version and the current
   version, then begin at 10% new and 90% current.
3. Check Sentry, PostHog, and Worker errors. Promote to 50%, then 100% when the
   rollout is healthy.

Use `bun run deploy:immediate` only for an emergency rollback or a release that
cannot run alongside the current version.
