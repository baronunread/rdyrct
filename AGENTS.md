# AGENTS.md

Guide for AI coding agents (and humans) working in this repo. `CLAUDE.md` is a
symlink to this file.

## What this is

**rdyrct**: an organization-based link shortener + QR generator that runs
entirely on **Cloudflare**: one Worker serves the API, the short-link redirects,
and the static SPA. Source of truth is **D1** (SQLite); the slug→destination hot
path is **KV**; custom domains use **Cloudflare for SaaS**. Product host:
`rdyrct.com`. Public repo: `github.com/baronunread/rdyrct`.

## Tooling: use bun

Always use **bun**, never npm/npx.

```sh
bun install
bun run dev                 # vite dev (Worker + SPA) on :5173
bunx emulate --service resend   # local Resend inbox on :4000 (read: curl :4000/emails -H 'authorization: Bearer test_token_admin')
bun run db:migrate:local    # apply migrations to local D1
bun run db:reset:local      # wipe local D1 + KV, re-apply migrations (start from scratch; restart dev after)
bun add <pkg>               # dependencies
```

**Two TypeScript projects; run BOTH after changes:**

```sh
bun run check                          # app + shared (tsconfig.json → src/app, src/shared)
bunx tsc -p tsconfig.worker.json --noEmit   # worker (src/worker)
bun run test                           # unit tests (bun test, tests/)
bun run doctor                         # react-doctor audit (React health score; --verbose for details)
```

react-doctor also runs as a pre-commit hook on staged files (`--blocking warning`)
and in CI (`.github/workflows/react-doctor.yml`, advisory on PRs). Its agent
skill lives in `.agents/skills/react-doctor`.

Shell writes to repo files are sandboxed; edit through the editor tools, not
`sed`/`perl` (or run bash with the sandbox disabled for scripted edits).

## Architecture

- **Worker** (`src/worker/index.ts`): custom-domain redirect middleware →
  BetterAuth at `/api/auth/*` → Polar webhook `/api/webhooks/polar` → API router
  (`/api/*`, behind `withSession`) → root `/:slug` redirect → SPA asset fallback.
- **Routing has NO `/app` prefix.** `/` is the marketing landing. Public routes:
  `/login`, `/signup`, `/privacy`, `/terms`, `/reset-password`,
  `/invite/:token`. The app lives at root keywords: `/dashboard` (quick link
  creation, quick stats, recent activity), `/analytics` (the full stats page), `/links`,
  `/domains`, `/members`, `/billing`, `/settings`, `/admin`. There is **no org id
  in URLs**: the current org is a localStorage-backed store, `useCurrentOrg`
  (`src/app/lib/current-org.ts`). Those keywords are reserved from custom slugs
  via `RESERVED_SLUGS` in `src/worker/util.ts` (the Worker also guards `/:slug`).
- **Billing is per-user, not per-org.** `user.plan` (`free`|`hobby`|`pro`) +
  Polar customer/subscription ids live on the user; each Polar product maps to
  a plan via `POLAR_*_PRODUCT_ID`. An org's effective limits are **its
  owner's plan**: `orgPlan()` in `src/worker/plan.ts` resolves the owner. Only
  Pro raises the owned-org cap above 1. Caps: `PLAN_LIMITS` in
  `src/shared/types.ts` (`{ orgs, links, members, domains, qr,
  analyticsDays }`). Slugs on the **shared** domain are always random (every
  plan); chosen slugs exist only on custom domains, so the shared namespace
  can't be squatted. New users get **no default org**: there is no onboarding
  route; org-scoped pages render `NoOrgState`
  (`src/app/components/no-org.tsx`) until they create one, and `/billing`
  works org-less, so landing paid CTAs (`/signup?next=/billing?plan=…`) can
  check out before the first org exists (`/onboarding` redirects to
  `/dashboard`).
- **Auth**: BetterAuth (email+password, `requireEmailVerification` via the
  `emailOTP` plugin, 6-digit code; password reset stays a link). PBKDF2/WebCrypto
  hashing (`src/worker/password.ts`). The account matching the `SUPERADMIN_EMAIL`
  secret is the platform admin; admin routes **404** (not 403) for everyone else.
  Platform admins can **ban** users (`user.banned`): banning wipes their sessions
  and `databaseHooks.session.create.before` (in `better-auth.ts`) refuses new
  ones, while their orgs/links keep working.
  Self-service account deletion is blocked while the user still owns an org.
- **KV keys**: `slug:{slug}` (shared host), `slug:{host}:{slug}` (custom domain),
  `domain:{host}`. D1 is authoritative; KV is the redirect hot path. Clicks are
  recorded via `waitUntil` after the redirect is sent, and store only
  country/referrer/device/timestamp, **never an IP address**.

## Conventions

- **Errors go to toasts** (`useToast`), never inline red field text.
- UI kit in `src/app/ui/`: Button (`primary|outline|ghost`, has `size`),
  Field/Input/Select, Dialog, Badge, Card/PageHeader/Table, Menu,
  Tooltip, toast, Skeleton (`ui/skeleton.tsx`; page-level skeletons that
  mirror each route's layout live in `src/app/components/skeletons.tsx`; use
  those instead of a spinner for page loading states), Spinner
  (`ui/spinner.tsx`; use it for in-flight buttons, never a `…` label).
  Design tokens: `bg`/`surface`/`surface-2`/`border`/`muted`/
  `text`/`accent`/`danger`. JetBrains Mono, theme-aware (light + dark).
- Data layer: `api()` + `ApiError` (`.status`, `.code`) in `src/app/lib/api.ts`;
  TanStack Query hooks in `src/app/lib/hooks.ts`.
- **Strict CSP** on published pages, everything self-contained: no remote fonts,
  images, scripts, or fetches. Icons via `lucide-react`; art via inline CSS/SVG.
- Email: `sendEmail()` (`src/worker/email.ts`) uses the Resend HTTP API via plain
  `fetch`, with `RESEND_BASE_URL` pointing at the emulator in dev. Keep it: the
  Resend SDK can't repoint its base URL, which would break the emulator flow.

## Writing copy

All user-facing copy (and this file) follows Orwell's six rules from
"Politics and the English Language":

1. Never use a metaphor, simile, or other figure of speech which you are used
   to seeing in print.
2. Never use a long word where a short one will do.
3. If it is possible to cut a word out, always cut it out.
4. Never use the passive where you can use the active.
5. Never use a foreign phrase, a scientific word, or a jargon word if you can
   think of an everyday English equivalent.
6. Break any of these rules sooner than say anything outright barbarous.

House rules on top of Orwell:

- **No em dashes.** Use a period, comma, colon, or parentheses instead.
- Say **"paid"** when a feature comes with any paid plan (Hobby or Pro);
  name **"Pro"** only for the things only Pro has (extra orgs, more domains).

## Config

Secrets live on the worker (set all at once with
`bunx wrangler secret bulk prod.secrets.env`, see `prod.secrets.env.example`)
and vars live in `wrangler.jsonc`; local dev reads everything from `.dev.vars`
(see `.dev.vars.example`). Key names:
`BETTER_AUTH_SECRET`, `SUPERADMIN_EMAIL`, `RESEND_API_KEY`, `MAIL_FROM`,
`APP_URL`, `APP_HOST`, `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET`/
`POLAR_PRO_PRODUCT_ID`/`POLAR_HOBBY_PRODUCT_ID`, `CF_API_TOKEN`/`CF_ZONE_ID`,
`DEV_FAKE_CF`.

## Layout

```
migrations/            D1 schema (numbered SQL migrations, applied in order)
src/worker/            Hono API, BetterAuth, KV publishing, redirect hot path
  routes/              auth (user), orgs, links, domains, billing, admin
  plan.ts util.ts email.ts password.ts kv.ts
src/shared/types.ts    DTOs + PLAN_LIMITS (shared worker ↔ app)
src/app/               React SPA
  routes/  ui/  components/  lib/
```
