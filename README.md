<div align="center">

# rdyrct

**Organization-based link shortener + QR codes, running entirely on Cloudflare's edge.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Built on Cloudflare Workers](https://img.shields.io/badge/Built%20on-Cloudflare%20Workers-f38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)](https://bun.sh)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)

</div>

---

## Deploy in one click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/baronunread/rdyrct)

This provisions the Worker from the Cloudflare dashboard and may prompt you to create or select the KV namespace and D1 database. You'll still need to paste their ids into `wrangler.jsonc`, set the secrets below, configure Polar, and point a domain at the Worker; see [Deploy to Cloudflare Workers](#deploy-to-cloudflare-workers).

---

## Features

- **Short links** with custom or random slugs, optional UTM parameters (source, medium, campaign, term, content) applied at redirect time.
- **QR codes** per link (Pro), with an optional logo in the center, live preview, and PNG/SVG download.
- **Custom domains** (Pro): connect `links.yourbrand.com` via Cloudflare for SaaS, with slugs namespaced per domain.
- **Organizations** with `owner` / `admin` / `member` roles: admins manage the team, domains, and billing; members manage links.
- **Magic-link invites**: single-use, valid for 7 days, sent by email.
- **Privacy-friendly analytics**: clicks per day, top links, countries, referrers, devices. No IP addresses are ever stored.
- **Per-user Free/Pro billing** through [Polar](https://polar.sh), which acts as Merchant of Record and handles tax/VAT.
- **Secret-pinned superadmin console**: the account matching `SUPERADMIN_EMAIL` gets a cloud-console panel for usage, org drill-down, and plan management. It 404s for everyone else.

---

## Stack

rdyrct is built Cloudflare-first: the entire product runs in a single Worker with no separate backend to host:

- **Cloudflare Workers**: one Worker serves the API, the redirect hot path, and the static React app.
- **D1**: SQLite at the edge, source of truth for auth, orgs, links, clicks, and domains.
- **KV**: slug → destination lookups on the redirect hot path, so a click never waits on D1.
- **Cloudflare for SaaS**: custom hostnames for Pro orgs' own short-link domains.

Application layer:

- [Hono](https://hono.dev) for routing
- [BetterAuth](https://better-auth.com) for email+password auth, with email-OTP verification and PBKDF2/WebCrypto hashing
- [Drizzle ORM](https://orm.drizzle.team) over D1
- React 19 + Vite + [`@cloudflare/vite-plugin`](https://github.com/cloudflare/workers-sdk)
- Tailwind v4 + [Base UI](https://base-ui.com)
- TanStack Query + React Router
- [Polar](https://polar.sh) for billing, [Resend](https://resend.com) for transactional email

---

## Local development

```sh
bun install
cp .dev.vars.example .dev.vars     # then edit; at minimum set SUPERADMIN_EMAIL

bunx emulate --service resend      # local Resend inbox on :4000

bun run db:migrate:local
bun run dev                        # http://localhost:5173
```

- Sign up with the address you set as `SUPERADMIN_EMAIL` to unlock the admin console; any other address is a normal user.
- New accounts land in onboarding to create their first organization.
- Email verification codes are sent through [emulate.dev](https://emulate.dev)'s Resend emulator instead of a real inbox. Read it with:

  ```sh
  curl localhost:4000/emails -H 'authorization: Bearer test_token_admin'
  ```

  and copy the 6-digit code out of the latest message.
- `DEV_FAKE_CF=1` (the `.dev.vars.example` default) stubs the Cloudflare Custom Hostnames API locally, so custom domains activate instantly on "Check status" without a real zone.
- Billing against a real [Polar sandbox](https://sandbox.polar.sh) account needs a public URL (`wrangler dev --remote` or a tunnel) for webhooks to reach `/api/webhooks/polar`.

---

## Deploy to Cloudflare Workers

Prefer the manual path, or need to redeploy after the button above? Create the resources:

```sh
bunx wrangler kv namespace create LINKS
bunx wrangler d1 create rdyrct
```

Paste the returned ids into `wrangler.jsonc`:

- `kv_namespaces[0].id`
- `d1_databases[0].database_id`

Fill in the non-secret vars in `wrangler.jsonc`:

- `APP_URL=https://rdyrct.com`
- `APP_HOST=rdyrct.com`
- `MAIL_FROM=rdyrct <no-reply@mail.rdyrct.com>`
- `POLAR_SERVER=sandbox` (or `production` when live)
- `POLAR_PRO_PRODUCT_ID` — create a recurring Pro product in Polar and paste its id
- `CF_ZONE_ID` — your `rdyrct.com` zone id

Set the secrets. Either one by one:

```sh
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put SUPERADMIN_EMAIL
bunx wrangler secret put RESEND_API_KEY
bunx wrangler secret put POLAR_ACCESS_TOKEN
bunx wrangler secret put POLAR_WEBHOOK_SECRET
bunx wrangler secret put CF_API_TOKEN
```

or in bulk with `cp prod.secrets.env.example prod.secrets.env`, fill it in, then:

```sh
bunx wrangler secret bulk prod.secrets.env && rm prod.secrets.env
```

Then migrate and ship:

```sh
bun run db:migrate:remote
bun run deploy
```

**Polar setup:** create an Organization Access Token with scopes `checkouts:write` and `customer_sessions:write`. Add a webhook endpoint at `https://rdyrct.com/api/webhooks/polar` and subscribe to `subscription.active`, `subscription.revoked`, `subscription.canceled`, and `subscription.uncanceled`.

Finally, point `rdyrct.com` at the Worker as a **custom domain**: Cloudflare dashboard → Workers → your worker → **Settings → Domains & Routes**. Short links live at the root (`https://rdyrct.com/<slug>`); the app is served on every other path.

**Customer custom domains (Pro):** to let orgs use `links.theirbrand.com`, enable [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) on the `rdyrct.com` zone, create an originless proxied fallback origin (e.g. `fallback.rdyrct.com AAAA 100::`), and add a Worker route `*/*` pointing at the `rdyrct` worker. The `CF_API_TOKEN` needs permission **Zone → SSL and Certificates → Edit** scoped to the zone. Also verify your sending domain (e.g. `mail.rdyrct.com`) in [Resend](https://resend.com) so transactional email isn't blocked.

---

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | secret | Signs sessions and tokens |
| `SUPERADMIN_EMAIL` | secret | The account that becomes the platform admin |
| `RESEND_API_KEY` | secret | Resend API key for transactional email |
| `POLAR_ACCESS_TOKEN` | secret | Polar API access token (scopes: `checkouts:write`, `customer_sessions:write`) |
| `POLAR_WEBHOOK_SECRET` | secret | Verifies Polar webhook signatures; endpoint `https://rdyrct.com/api/webhooks/polar` |
| `CF_API_TOKEN` | secret | Cloudflare token with **Zone → SSL and Certificates → Edit** (custom domains) |
| `APP_URL` | var | Full public URL of the app, e.g. `https://rdyrct.com` |
| `APP_HOST` | var | Public host, e.g. `rdyrct.com` |
| `MAIL_FROM` | var | From address for outgoing email |
| `RESEND_BASE_URL` | var (dev only) | Points at the local Resend emulator |
| `POLAR_SERVER` | var | `sandbox` or `production` |
| `POLAR_PRO_PRODUCT_ID` | var | Polar product id for the Pro plan |
| `CF_ZONE_ID` | var | Zone id used for Custom Hostnames |
| `DEV_FAKE_CF` | var (dev only) | `1` to stub the Cloudflare API locally |

Secrets are set with `wrangler secret put NAME` or `wrangler secret bulk prod.secrets.env` in production; locally they all come from `.dev.vars` (see `.dev.vars.example`).

---

## Project layout

```
migrations/            D1 schema (auth + app tables)
src/worker/             Hono API, BetterAuth, KV publishing, redirect hot path
  routes/               auth/user, orgs, links, domains, billing, admin
src/shared/types.ts     DTOs + plan limits shared between worker and app
src/app/                React SPA
  routes/               page-level route components
  ui/                   design-system primitives
  components/           feature components
  lib/                  client utilities, API hooks
```

---

## License

MIT © Andrea Bruno. See [LICENSE](LICENSE).
