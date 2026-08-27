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
bun run dev                 # vite dev (Worker + SPA) via portless: https://rdyrct.localhost
bun run mail                # local Resend inbox via portless: https://mail.rdyrct.localhost (read: curl https://mail.rdyrct.localhost/emails -H 'authorization: Bearer test_token_admin')
bun run db:migrate:local    # apply migrations to local D1
bun run db:reset:local      # wipe local D1 + KV, re-apply migrations (start from scratch; restart dev after)
bun add <pkg>               # dependencies
bunx agent-browser          # real-browser checks: screenshots, clicking through pages. Use it for any visual verification; do not hand-roll headless Chrome
bun run db:seed:local       # seed local D1/KV with fake data (run dev server first)
```

**Local Cloudflare state**: while `bun run dev` runs, the Explorer API at
`https://rdyrct.localhost/cdn-cgi/explorer/api` exposes the local KV, R2, D1,
Durable Objects, and Workflows. Fetch that URL for the OpenAPI schema, then use
it to list, query, and manage local resources (e.g. inspect D1 rows or KV keys
without wrangler CLI calls).

**Three TypeScript projects; run ALL THREE after changes:**

```sh
bun run check                          # app + shared (tsconfig.json → src/app, src/shared)
bunx tsc -p tsconfig.worker.json --noEmit   # worker (src/worker)
bunx tsc -p tests/worker/tsconfig.json --noEmit  # worker tests (tests/worker)
bun run test                           # unit tests (bun test, tests/)
bun run test:worker                    # worker tests (vitest-pool-workers, tests/worker/)
bun run e2e:smoke                      # browser tests (playwright, tests/e2e/); needs .dev.vars
bun run verify                         # static checks + unit + worker tests, no e2e: the local gate
bun run verify:e2e                     # verify + the full e2e:smoke suite: what CI runs
bun run doctor                         # react-doctor audit (React health score; --verbose for details)
bun run fallow                         # fallow gate: what this branch adds over main
```

**Every new feature ships with an e2e scenario.** Not a suggestion. The
worker test environment has no built asset bundle, so it never touches the
real `ASSETS` binding: checks that stop at `test` and `test:worker` have
already let two bugs through that broke the app for every visitor. Green on
`verify` alone means the static checks and non-browser tests pass, not that
the app runs in a browser — only `verify:e2e` (or CI) proves that. Add a
`tests/e2e/*.pw.ts` scenario alongside the feature, in the same commit, even
though writing it does not require running the full suite locally.

**Run tests scoped to the blast radius while iterating, not the full
suite.** `bun run verify:e2e` is the gate CI runs, unscoped, before a PR
merges — that stays mandatory, and the full `e2e:smoke` run only happens
there, never as a local default. Re-running every unit test, worker test and
e2e spec after every edit is not extra safety, it's noise that hides which
check actually matters: a change to QR-logo storage doesn't need the billing
or short-link-creation specs to pass again, it needs the ones that touch R2,
the qr-logo routes, and whatever renders the logo. Find the blast radius
first (`codegraph_explore`'s blast-radius summary, or `git diff` against
callers) and run only the matching files: `bun test tests/<file>.test.ts`,
`bunx vitest run tests/worker/<file>.worker.ts`,
`bunx playwright test tests/e2e/<file>.pw.ts`. Run `bun run verify` (still no
e2e) once, at the end, before calling the work done — CI is what decides
whether the full browser suite passes.

**The worker tests typecheck.** vitest does not, so `verify` runs tsc over
`tests/worker` as its own project. `tests/worker/env.d.ts` declares
`Cloudflare.Env` (what `env` from `cloudflare:workers` resolves to) as our
hand-written `Env`, which is why no generated `worker-configuration.d.ts` is
committed. `tests/` and `tests/e2e/` are still unchecked: they mix DOM and
Workers globals in one directory, so they need untangling first.

**Checks run in one place each.** The pre-commit hook only formats staged
files, because that is the one job that repairs instead of complaining.
Everything that reports runs in CI, where nobody can pass `--no-verify`:
`.github/workflows/test.yml` runs the same checks as `bun run verify:e2e`,
split across parallel jobs (static checks, unit/worker tests, and a 3-way
sharded e2e run) to cut wall-clock time, and
`.github/workflows/react-doctor.yml` blocks on any new react-doctor finding
(changed files, against the merge base) for PRs and main.

Lint and format take no path list: `.` plus the ignores in `.gitignore` and
`.oxfmtrc.json`. One scope, so the hook and CI cannot check different files.

**anti-slop** is an oxlint plugin, vendored in `.oxlint/anti-slop`, that
refuses the shapes code takes when the author did not know the type: `as
unknown as`, `unknown` parameters, `Record<string, unknown>`, `typeof`
narrowing of a value nobody parsed, and any assertion with no stated
invariant. Its fifteen rules run at `error` in `.oxlintrc.json`.

What it asks for, when it fires: parse the value where it arrives (valibot,
via `parseBody` in `src/worker/schemas.ts`), name the type it parses to, or
write a `SAFETY:` comment on the line above saying which invariant makes the
assertion sound. `JsonValue`, `lookup`, `oneOf`, `nonEmpty` and `orgPlanOf`
in `src/shared` exist for the cases that come up repeatedly. The plugin is
someone else's code, so oxlint, oxfmt, fallow and react-doctor all skip it.

`bun run fallow` is the gate: it scopes to the files this branch changed and
fails only on findings the branch introduced, counted against
`fallow-baselines/health.json`. Refresh that baseline with
`bunx fallow health --save-baseline fallow-baselines/health.json` after a
refactor moves findings around, and say in the commit message which counts
moved. For the whole-repo picture (refactoring targets, hotspots) run
`bunx fallow`: it reports every finding and exits 1 by design, so it stays a
reading exercise. Track what it turns up in issues rather than blocking CI.

react-doctor skill lives in `.agents/skills/react-doctor` and `.claude/skills/react-doctor`.
fallow skill lives in `.claude/skills/fallow`.

**rdyrct-design** (`.claude/skills/rdyrct-design`, symlinked from
`.agents/skills`) is this project's own design system: the two type rules,
the colour tokens, the component inventory, layout, motion, copy and the
anti-patterns. Read it before writing any interface, on any surface,
including the admin screens. It exists because this repo is edited by agents
constantly and each one otherwise re-derives the same conventions out of
`src/app/ui/` by guessing. Same reason this file exists.

**ship-issue** (`.claude/skills/ship-issue`, symlinked from `.agents/skills`)
is how work gets landed: evaluate the issue before branching, mutation-test
any new guard, read the review body rather than trusting the green check, get
a cold review, then merge. This file says what the checks are; that one says
when to run them and what to do with what they say.

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
  The last `/user` answer is cached in localStorage too
  (`src/app/lib/user-cache.ts`), so a reload paints the sidebar, org switcher
  and user footer at once and only the page under them waits. **The cache is
  chrome, never an answer.** Only `useShellUser`/`useShellOrgs` read it, and
  only `RequireAuth` and `AppShell` call those. Everything the app decides or
  submits (`useCurrentUser`, `useCurrentOrg`, `useOrgLimits`, `RequireAdmin`)
  waits for the round trip, because the cache is one page load out of date by
  definition: seed it into the query instead and somebody who changes their
  org's default domain and reloads gets a link editor still preselecting the
  old one. Sign-out clears it.
- **Billing is per-user, not per-org.** `user.plan` (`free`|`hobby`|`pro`) +
  Polar customer/subscription ids live on the user; each Polar product maps to
  a plan via `POLAR_*_PRODUCT_ID`. An org's effective limits are **its
  owner's plan**: `orgPlan()` in `src/worker/plan.ts` resolves the owner. Only
  Pro raises the owned-org cap above 1. Caps: `PLAN_LIMITS` in
  `src/shared/types.ts` (`{ orgs, links, members, domains, qr,
analyticsDays }`). Slugs on the **shared** domain are always random (every
  plan); chosen slugs exist only on custom domains, so the shared namespace
  can't be squatted. Every account gets an org at
  sign-up (#65), named from the email domain (`src/shared/org-name.ts`) and
  renameable in Settings, so nobody meets a dead app behind a form asking
  for a company name. The dashboard asks for a **link** until there is one,
  then goes back to being a dashboard. `NoOrgState`
  (`src/app/components/no-org.tsx`) is still there for the account that has
  no org left (it deleted the only one), and `/billing` still works org-less,
  so landing paid CTAs (`/signup?next=/billing?plan=…`) can check out before
  the first org exists (`/onboarding` redirects to `/dashboard`).
- **A downgrade never deletes** (#29). Every plan change runs
  `reconcileUser()` (`src/worker/reconcile.ts`): from the Polar webhook, from
  an admin comp grant or revoke, and by hand from
  `POST /api/admin/users/:id/reconcile`. It records what is over cap in
  `org_entitlements` and marks the resources beyond it, and the marks are
  what everything else reads: `orgs.locked_at` makes an org read-only in
  `requireOrgRole` (its links keep redirecting), `domains.locked_at` plus
  the org's `grace_ends_at` become `servesUntil` in the domain's KV value so
  the redirect path enforces the 30 days with no D1 read, and
  `org_members.previous_role` is what an upgrade reads to put demoted members
  back. Idempotent: every decision is recomputed from live rows, and the
  grace period only restarts when the plan the last pass compared against is
  not the plan this one sees. The owner picks which org stays active
  (`POST /orgs/:orgId/keep-active`) and who keeps write access (the member
  role PATCH); reconciliation defaults to longest-standing so an owner who
  ignores both still has a working account. Two emails, day 0 from the pass
  and day 23 from the daily cron (`sweepGraceWarnings`). The UI says all of
  it through one `OverLimitBanner` and one `LockedPanel`
  (`src/app/components/over-limit.tsx`): use those rather than inventing a
  fourth way to say "this is over your plan".
- **Auth**: BetterAuth (email+password, `requireEmailVerification` via the
  `emailOTP` plugin, 6-digit code; password reset stays a link). PBKDF2/WebCrypto
  hashing (`src/worker/password.ts`). The account matching the `SUPERADMIN_EMAIL`
  secret is the platform admin; admin routes **404** (not 403) for everyone else.
  Platform admins can **ban** users (`user.banned`): banning wipes their sessions
  and `databaseHooks.session.create.before` (in `better-auth.ts`) refuses new
  ones, while their orgs/links keep working.
  Deleting an account takes every org it **owns** with it, teammates
  included: an org has no plan of its own (`orgPlan()` reads its owner's), so
  one left ownerless would have no plan, no billing and nobody who could
  delete it. Settings names each org in the confirmation first. Orgs the
  account only belongs to are untouched.
- **Bot protection**: Cap proof-of-work (`src/worker/cap.ts`, routes at
  `/api/cap/:scope/{challenge,redeem}`) guards signup and password reset. The
  token rides in an `x-cap-token` header and is spent in `hooks.before`. No
  third party sees the visitor: `capjs-core` runs in this Worker, the widget
  is bundled from npm, and the WASM solver is a same-origin Vite asset. Unset
  `CAP_SECRET` disables it. See `docs/rate-limiting.md` for all three layers
  (WAF rules, Workers limiters, Cap) and the dashboard rules to apply by hand.
- **KV keys**: `slug:{slug}` (shared host), `slug:{host}:{slug}` (custom domain),
  `domain:{host}`. D1 is authoritative; KV is the redirect hot path. Clicks are
  recorded via `waitUntil` after the redirect is sent, and store only
  country/referrer/device/timestamp, **never an IP address**.
- **QR logos live in R2** (binding `QR_LOGOS`, bucket `rdyrct-qr-logos`), keyed
  `{orgId}/{fileId}.{ext}`. The `qr_logo` columns store only the serving URL
  (`/api/orgs/<orgId>/qr-logo/<file>`), never image bytes. Upload and serving
  are the same org-scoped route (`POST`/`GET /api/orgs/:orgId/qr-logo[/:file]`),
  gated to org members: only the signed-in app ever fetches a logo (QR
  previews/downloads bake the image in client-side), and a row may only
  reference its own org's logos. Paid plans, ≤ 256 KB
  (`QR_LOGO_MAX_BYTES`) and ≤ 512 px on a side (`QR_LOGO_MAX_DIMENSION`),
  both in `src/shared/types.ts`; the client downscales and compresses to fit
  before uploading, and the server rejects whatever still exceeds them.
  Serving is immutable and
  `private`-cached. Deletes follow the row: replace/clear/delete on
  links and orgs removes the object; org teardown wipes the `{orgId}/` prefix
  (`src/worker/storage.ts`).

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

Copy is design material, so the rules below and the ones in the
**rdyrct-design** skill are one set: that skill covers what a control says,
what an error says, and what an empty state says.

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
`SENTRY_DSN`.

## Layout

```
migrations/            D1 schema (numbered SQL migrations, applied in order)
scripts/               Local dev utilities (e.g. seed-local.ts)
src/worker/            Hono API, BetterAuth, KV publishing, redirect hot path
  routes/              auth (user), orgs, links, qr-logos, domains, billing, admin
  better-auth.ts plan.ts reconcile.ts util.ts guards.ts org-role.ts rate-limit.ts session.ts
  email.ts password.ts kv.ts storage.ts sentry.ts clicks.ts workflows.ts
src/shared/types.ts    DTOs + PLAN_LIMITS (shared worker ↔ app)
src/app/               React SPA
  routes/  ui/  components/  lib/
.agents/skills/        Agent skills (react-doctor)
.claude/skills/        Claude skills (fallow, react-doctor)
```

<!-- evlog:start -->

## Logging with evlog

This project uses [evlog](https://evlog.dev). Follow these rules when you add or change logging.

**One wide event per operation.** A request, a job, a user action — each produces exactly one
event carrying everything about it. Not one log line per step.

- Get the request logger with `c.get('log')` or `useLogger()` from `evlog/hono` inside a route handler.
- Add context as you learn it: `log.set({ user: { id, plan }, cart: { items, total } })`.
- Group related fields into objects. Never flat abbreviations like `{ uid, n, t }`.
- Never pass a raw body — `log.set({ user: body })` leaks passwords. List fields explicitly.
- Do not time anything by hand; the duration is computed when the event emits.
- `log.debug()` is for step detail and is stripped from production builds.

**Errors are structured, never bare.**

```ts
throw createError({
  message: "Payment failed",
  status: 402,
  why: "Card declined by the issuer",
  fix: "Use a different payment method",
  internal: { correlationId }, // drains only — never reaches the client
});
```

Never `throw new Error(...)`. Never `console.error(e); throw e` — use `log.error(e)`.
When the same error appears in three or more places, promote it to `defineErrorCatalog()`.

**Sensitive actions get an audit trail.** Call `log.audit({ action, actor, target, outcome })`
on anything that changes permissions, money, or personal data. Audit entries are never sampled.

**Never log** passwords, tokens, API keys, full card numbers, or session JWTs. Redaction is on
in production, but it is a safety net — not a substitute for choosing the fields yourself.

Check coverage with `npx @evlog/cli map --no-write`. Diagnose setup with `npx @evlog/cli doctor`.
Deeper guidance is in the `review-logging-patterns` skill — read it before a logging change.
<!-- evlog:end -->
