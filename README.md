# shrtnr·

Organization-based link shortener + QR code generator, running entirely on
Cloudflare Workers with KV and D1. Same look and feel as brnr.dev: JetBrains
Mono, dark pastel theme with a paper light mode.

## Features

- **Short links** with custom or random slugs, optional UTM parameters
  (source, medium, campaign, term, content) applied at redirect time.
- **QR codes** per link, with an optional logo in the center. Live preview,
  PNG/SVG download.
- **Organizations** with roles: `owner`, `admin` (manages the team), `member`
  (manages links). Single-use invite links, valid 7 days.
- **Analytics**: clicks per day, top links, countries, referrers, devices.
  Click recording happens after the redirect is sent (`waitUntil`), so the
  hot path stays a single KV read.
- **Platform admin**: the first account to sign up becomes the instance
  admin, and gets a cloud-console style panel with usage across all orgs,
  plus org/user management.

## Stack

- Cloudflare Worker (single worker: API + redirects + static assets)
- [Hono](https://hono.dev) router, sessions in D1 (cookie + PBKDF2 passwords)
- **D1** as source of truth (users, orgs, links, clicks), **KV** for the
  slug → destination hot path
- React 19 + Vite + `@cloudflare/vite-plugin`
- [coss ui](https://coss.com/ui)-style components: Base UI primitives +
  Tailwind v4, copy-paste ownership model (see `src/app/ui/`)
- TanStack Query, React Router, `qr-code-styling`, drizzle-orm

## Develop

```sh
npm install
npm run db:migrate:local
npm run dev
```

Sign up: the first account becomes the platform admin.

## Deploy

```sh
npx wrangler kv namespace create LINKS
npx wrangler d1 create shrtnr
# paste both ids into wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

Point a custom domain at the worker and short links live at the root
(`https://yourdomain/slug`); the app is served on every non-slug path.

## Layout

```
migrations/            D1 schema
src/worker/            Hono API, auth, KV publishing, redirect hot path
src/shared/types.ts    DTOs shared between worker and app
src/app/               React SPA (routes/, ui/ kit, components/)
```
