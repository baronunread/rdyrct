# Spike: Vite+ (`vp`) for rdyrct

Date: 2026-11-09. Machine: Apple Silicon, 8 cores, bun 1.4.4, Node 26.5.1.
Nothing here is meant to merge. The branch tree is the current toolchain plus
this file and `spike/vite-plus-migrate.patch` (the raw result of `vp migrate`
plus the vitest-plugin swap, to inspect or `git apply`). The commit history
holds the intermediate states.

## Verdict: not yet

Do not adopt now. Vite+ itself works well on the parts we use (build, dev,
lint with our anti-slop plugin). But it has two hard costs that the gain does
not pay for today:

1. **It forces Vitest 5, and our worker tests do not run on Vitest 5.** The
   full worker suite crashes workerd ("Worker exited unexpectedly") on
   `@cloudflare/vitest-plugin` 1.6.1 + Vitest 5.1.0. Individual files pass.
   `@cloudflare/vitest-pool-workers` 0.23 (what we use) only supports Vitest 4
   and is deprecated for `@cloudflare/vitest-plugin`.
2. **Everything we do is already fast and already oxc-based.** Build 3 s,
   lint 1 s, format 0.1 s, typecheck 0.7 s (three projects, TS 7 native),
   unit tests 0.6 s, dev server ready in 3 s. Vite+ is the same Vite 8 /
   Rolldown / Oxlint / Oxfmt underneath, so it saves no time. The only
   remaining slow step, worker tests (about 110 s), is not something Vite+
   speeds up.

Revisit when `@cloudflare/vitest-plugin` is stable on Vitest 5 (re-run the
worker suite; it is the one gate). Everything else is ready.

## Research (as of 2026-11-09)

- Version: `vite-plus` **1.5.1** on npm (`latest`), MIT.
  https://github.com/voidzero-dev/vite-plus ("fully open-source under the MIT
  license"). No pricing found on the docs; footer reads VoidZero Inc.
- What it is: "the unified toolchain and entry point for web development",
  bundling Vite, Vitest, Oxlint, Oxfmt, Rolldown, tsdown and Vite Task in one
  `vite-plus` package plus a `vp` CLI. https://viteplus.dev/guide/
- Commands (`vp help`): create, migrate, install/add/remove/update, dev,
  build, preview, check, lint, fmt, test, run (task runner with cache), exec,
  dlx, pack, staged, config (hooks), env, upgrade. Bun is supported ("wraps
  your package manager (pnpm, npm, Yarn, or Bun)").
- Config: lives in `vite.config.ts` (`defineConfig` from `vite-plus`, with
  `lint`, `fmt`, `staged`, `test`, `run` blocks). https://viteplus.dev/guide/lint
- Vite plugins: it is Vite, so `@cloudflare/vite-plugin` works (verified).
- Oxlint JS plugins: documented ("JS Plugins ... register under
  `lint.jsPlugins`") and verified with anti-slop.
- Migration: `vp migrate` rewrites imports, merges tool config into
  `vite.config.ts`, updates scripts and deps. "Most projects will require
  further manual adjustments." Vitest is re-exported as v5.1.0.
  https://viteplus.dev/guide/migrate
- Node requirement `^22.18 || ^24.11 || >=26`.

## What I ran

| #   | Step                   | Command                                                                                    | Result                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Install                | `bun add -d vite-plus`                                                                     | OK, 3.1 s. Installs `vp`, `vpr`, `vpx` bins.                                                                                                                                                                                                                                                                              |
| 1   | Migrate                | `vp migrate --no-interactive --no-hooks --no-agent --no-editor`                            | OK, 16.6 s. See "What migrate did".                                                                                                                                                                                                                                                                                       |
| 2   | Build (rdyrct.com)     | `VITE_RDYRCT_SITE=1 bun run build` (vp)                                                    | OK, 3.1-3.5 s vs 3.1 s today. 1083 files in both, same names after hash normalising; JS 4,925,923 vs 4,926,549 bytes; CSS identical; worker 2.93 MB vs 2.95 MB.                                                                                                                                                           |
| 2   | Build (self-host)      | `VITE_RDYRCT_SITE=0 bun run build`                                                         | OK, 2.4 s vs 2.3 s. 1018 files both; JS 4,361,611 vs 4,362,104 bytes.                                                                                                                                                                                                                                                     |
| 3   | Dev                    | `vp dev --host localhost --port N`                                                         | OK. Ready and serving `/login`, `/api/config`, `/links` in 2.9-3.1 s, identical to `vite dev` (2.9-3.1 s). Cloudflare plugin, `.dev.vars`, CSP all as before.                                                                                                                                                             |
| 4   | Worker tests, one file | `vp test run --config vitest.config.ts tests/worker/self-host.worker.ts`                   | With pool-workers 0.23: fails (`SyntaxError: Unexpected identifier 'file'`). After swapping to `@cloudflare/vitest-plugin`: passes, 17 tests.                                                                                                                                                                             |
| 4   | Worker tests, all      | `vp test run --config vitest.config.ts`                                                    | **Fails.** First ~9 files pass, then ~65 "Worker exited unexpectedly" errors. Same with `--maxWorkers=1` and `=4`, with `vitest run` directly (not a `vp` issue), and with click-rollups excluded. Files pass when run in small groups.                                                                                   |
| 4   | Control                | plugin 1.6.1 + Vitest **4.1.12** on baseline, plain `vitest run`                           | 998 pass, 1 fails (below). No crashes. So the crash is Vitest 5 + plugin 1.6.1.                                                                                                                                                                                                                                           |
| 5   | Lint                   | `vp lint --deny-warnings .`                                                                | OK, 1.3-1.8 s vs 0.7-1.0 s for `oxlint`. Reads `.oxlintrc.json` as is and runs anti-slop (a planted `as unknown as string` was reported by `no-unknown-parameters`, `no-chained-type-assertions`, `require-safety-comment-for-type-assertion`). Bundles oxlint 1.91 vs our pinned 1.90.                                   |
| 5   | Lint via `lint` block  | `lint: { jsPlugins, rules, ignorePatterns }` in `vite.config.ts`, `.oxlintrc.json` removed | OK, same output.                                                                                                                                                                                                                                                                                                          |
| 5   | Format                 | `vp fmt --check`                                                                           | Does **not** read `.oxfmtrc.json` ("No config found"), so skills dirs get flagged (26 files). `vp fmt --check -c .oxfmtrc.json` passes (648 files), or move to a `fmt` block. 0.65-1.2 s vs 0.04 s for `bun fmt`.                                                                                                         |
| 6   | Typecheck              | `vp check`                                                                                 | Runs fmt + lint only. With `lint.options: { typeAware: true, typeCheck: true }` it uses tsgolint on the root tsconfig only: 354 errors, 103 warnings, almost all false "error type" noise (Worker types such as `D1PreparedStatement` live in `tsconfig.worker.json`). Does not replace `bun run check` (three projects). |
| 7   | Tasks                  | `vp run lint`                                                                              | Runs package scripts with a cache. We do not need it.                                                                                                                                                                                                                                                                     |

## What `vp migrate` did

- `vite` becomes `npm:@voidzero-dev/vite-plus-core@1.5.1` in dependencies **and**
  `overrides`. `vp` refuses to run unless this alias is present ("Expected
  @voidzero-dev/vite-plus-core ... Run `vp migrate`"), so `vp` and plain `vite`
  cannot coexist in one install. After aliasing, `node_modules/.bin/vite`
  points at a file that does not exist, so `bunx vite dev` (Playwright config)
  and `portless <name> vite dev` (scripts/dev.ts) would have to become `vp dev`.
- `vitest` becomes 5.1.0 (also overridden); `oxlint` dependency removed.
- 77 test files had `from "vitest"` rewritten to `from "vite-plus/test"`;
  `vite.config.ts` and `vitest.config.ts` import `defineConfig` from
  `vite-plus`. A `clearMocks: false` compatibility setting was added.
- 4 review warnings (expect.poll timeout, per-project server lifecycle).
- It did **not** merge `.oxlintrc.json` / `.oxfmtrc.json` (lint still reads the
  file, fmt does not), did not touch `bun check`, lefthook or CI.
- Its lefthook hook ran during the migrate commit; it leaves lefthook alone
  with a warning.

## Table

| Area                    | Works?                | Speed vs today                           | Effort                                                                                 | Risks                                                                                                                                                          |
| ----------------------- | --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build                   | Yes, identical output | Same (3.1-3.5 s vs 3.1 s)                | Low (alias `vite`, `vp build`)                                                         | Alias is mandatory and breaks the `vite` bin. Prerender scripts import `vite`'s `loadEnv`; worked.                                                             |
| Dev                     | Yes                   | Same (about 3 s)                         | Low: `scripts/dev.ts` line 125 and `playwright*.config.ts` `bunx vite dev` -> `vp dev` | Playwright servers and portless must all switch together.                                                                                                      |
| Worker tests            | **No** (full suite)   | n/a (today 111 s)                        | High, blocked                                                                          | Needs Vitest 5 + `@cloudflare/vitest-plugin`; crashes workerd on full runs. Pool package is deprecated anyway; plugin on Vitest 4 has its own failure (below). |
| Unit tests (`bun test`) | Should stay           | n/a                                      | None                                                                                   | Tests use `bun:test`; `vp test` is Vitest, so they would need a port. Not worth it (0.6 s today).                                                              |
| Lint                    | Yes, incl. anti-slop  | Slightly slower (1.3-1.8 s vs 0.7-1.0 s) | Low                                                                                    | Bundled oxlint 1.91 vs pinned 1.90; our `@oxlint/plugins` pin may drift.                                                                                       |
| Format                  | Partly                | Slower than `bun fmt` (0.65 s vs 0.04 s) | Low (`-c` or `fmt` block)                                                              | Does not auto-read `.oxfmtrc.json`. `bun fmt --staged` hook needs a `vp staged` rewrite.                                                                       |
| Typecheck               | No                    | n/a                                      | n/a                                                                                    | `vp check` type-aware mode (tsgolint, one tsconfig) cannot express our 3 projects. Keep `bun check`.                                                           |
| CI / lefthook           | Not touched           | none                                     | Medium                                                                                 | CI would add `vp` only via scripts; `setup-bun` is enough. The Playwright/`fallow`/`react-doctor` tools also resolve `vite`, and now see the alias.            |

## Blockers

1. `@cloudflare/vitest-plugin` 1.6.1 + Vitest 5.1.0: full worker suite crashes
   (all files pass singly). Not Vite+ specific (reproduced with `vitest run`).
2. Vitest 4 cannot stay beside `vite-plus`: its Vitest 5 sub-packages hoist, and
   `vitest@4` then fails with `@vitest/utils/display does not provide an export
   named 'objDisplay'`. So Vite+ forces the Vitest 5 move.
3. Separate from Vite+: `@cloudflare/vitest-plugin` (successor package) fails one
   existing test on newer workerd, `click-rollups.worker.ts` "runs one day range
   at a time": `D1_ERROR: Wrong number of parameter bindings`. Real finding to
   fix before ever moving to the plugin.
4. `vp` needs the `vite` alias; plain `vite` bin goes away.

## Migration plan (if the blockers clear)

1. Separate PR, no Vite+: move to `@cloudflare/vitest-plugin` on Vitest 4;
   fix the `click-rollups` binding bug (`bunx @cloudflare/codemods
   vitest:pool-workers-to-vitest-plugin`).
2. When the plugin is stable on Vitest 5, move to Vitest 5 alone and get
   `bun run test:worker` green on a full run.
3. Then `bun add -d vite-plus`, `bunx vp migrate --no-interactive --no-hooks
   --no-agent --no-editor`, apply `spike/vite-plus-migrate.patch` as a guide.
4. Switch `vite dev` to `vp dev` in `scripts/dev.ts` and the three Playwright
   configs; `vite build` to `vp build`.
5. Optionally `vp lint` (keep `.oxlintrc.json`) and `vp fmt -c .oxfmtrc.json`.
   Keep `bun check`, `bun test`, fallow, react-doctor, lefthook.
6. Check: `bun run verify`, `e2e:production`, `e2e:self-host`, and diff `dist/`.

The gain from steps 3-5 is mostly one dependency and one config file, not speed.

## Uncertain

- Pricing: nothing found beyond MIT. Not checked further.
- Whether the workerd crash is in `@cloudflare/vitest-plugin`, Vitest 5 or
  miniflare 5 beta; I did not debug it (time box).
- CI changes were assessed from reading `.github/workflows/test.yml` only; not run.
- `vp migrate` was run with `--no-hooks`; hook migration (`vp staged`) was not
  tried.
- Timings are single runs on a busy laptop; the worker suite varied 111 s to
  148 s with identical code.
