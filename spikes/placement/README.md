# D1 placement preview spike

This standalone Worker compares ten serial indexed reads directly with the
same reads through one HTTP loopback. Two previews use identical code and
the same **synthetic** D1 database, with placement off or smart. The product
Worker, routes, queues, cron, production D1 and KV are not involved.

Preview information pages:

- https://default-rdyrct-placement-spike.baronunreadts.workers.dev
- https://smart-rdyrct-placement-spike.baronunreadts.workers.dev

Queries require an isolated bearer secret. Destinations are fixed in config;
there is no caller-supplied target. `/loopback` only calls `/query`, which
cannot recurse. Each request performs ten reads. Redirects are refused, the
inner request has a ten-second timeout, and the client has a fifteen-second
timeout. There are no application retries; D1 attempt metadata is recorded.

## What this can establish

[Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/)
allows placement overrides, but cron and queue consumers do not target
previews. Service bindings from previews target production deployments.
Therefore this tests a **public HTTP loopback**, not an internal service
binding, and does not reproduce cron/queue placement.

[Global fetch strictly public](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
is enabled on both previews. Initial requests returned 1042 before the
updated deployment propagated, then both paths passed. `redirect: "error"`
also threw in the deployed runtime, so this uses manual redirects and
explicitly refuses 3xx responses.

The original post is unavailable. Its exact mechanism, database, regions,
workload and claimed percentage remain unverified. The application's D1
work includes scheduled grace warnings and queue-backed storage/click work;
no production placement setting is enabled. This experiment cannot establish
that those triggers have a measurable latency problem.

[Placement docs](https://developers.cloudflare.com/workers/configuration/placement/)
describe placement for fetch handlers. D1 is a managed Cloudflare database,
not a single external database host to map to an AWS/GCP region by guesswork.
[D1 location](https://developers.cloudflare.com/d1/configuration/data-location/)
and [read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
must be considered separately. This synthetic database has a WEUR creation
hint, reads its primary without a D1 session, and reports MAD in every trial.
Neither preview emitted `cf-placement`. A D1 served-by colo is not evidence
of the Worker's execution location.

## Measurements and decision

Two runs used 30 measured trials per variant/path, with three warmup trials,
alternating variant and path order, and concurrency one. Each run completed
120/120 measured requests successfully with identical IDs. Raw final-run
samples, metadata, median, p90 and min/max are in `results.json`.

Final run, milliseconds for ten queries:

| Placement | Path     | Client median | Client p90 | Client min–max | Query median |
| --------- | -------- | ------------: | ---------: | -------------: | -----------: |
| Off       | Direct   |         450.2 |      496.8 |    413.4–585.2 |        381.0 |
| Off       | Loopback |         465.2 |      513.2 |    436.5–566.0 |        383.5 |
| Smart     | Direct   |         429.9 |      473.4 |    412.9–489.8 |        360.0 |
| Smart     | Loopback |         447.7 |      470.3 |    426.9–509.3 |        360.5 |

The first run's direct medians were 388.7/387.6 ms (off/smart), and loopback
398.6/399.7 ms. The smart difference did not repeat at the same magnitude.
Loopback added client time in both runs. Local macOS arm64/Bun 1.4.2 and
Internet conditions are documented in the raw output; these are not CI or
real trigger measurements. No adoption or percentage speedup follows.

Cold installation and isolate startup were not benchmarked. Warmups are
excluded from summaries but retained in raw records. Wrangler reported
roughly 1 ms script startup, a deployment metric rather than a cold request
measurement. Runner/Worker compute cost was not measured.

An extra fetch adds an invocation and a network/failure boundary. A timeout
does not guarantee cancellation of downstream work. Retrying writes could
repeat side effects, so real queue use would need idempotency, explicit
retry/ack handling, deadlines and error visibility. Authentication prevents
public benchmark traffic; the experiment contains only synthetic data.

Keep the current product runner arrangement. Before another spike, identify
the original supported mechanism and measure the actual D1 trigger workload
on an isolated ordinary staging Worker that can receive cron/queue events.
Require repeatable end-to-end improvement and equal correctness before any
product change.

## Reproduce

Use Bun 1.4.2 and the repository's installed Wrangler. These configs point
only at `rdyrct-placement-spike`, database
`b5294461-23e2-44b1-9be5-133bd2b943ca`. For another account, create a new test
database, replace both IDs and preview origins, and update benchmark/test
origins. Never substitute production bindings.

1. Create an untracked JSON secret file containing a fresh `BENCH_KEY`.
2. Seed the synthetic DB:
   `bunx wrangler d1 execute rdyrct-placement-spike --remote --config spikes/placement/default.jsonc --file spikes/placement/seed.sql`.
3. Deploy each config with
   `bunx wrangler preview --config spikes/placement/default.jsonc --name default --ignore-base-config --secrets-file <secret-file>`
   and the matching smart config/name. Allow deployment propagation.
4. Run `BENCH_SECRETS_FILE=<secret-file> bun run spike:placement:e2e`, then
   `BENCH_SECRETS_FILE=<secret-file> bun run spike:placement`.
5. Run `bunx tsc -p spikes/placement/tsconfig.json` and the scoped Worker test.

The live e2e scenario requires an explicit secret-file environment variable
and otherwise skips in the ordinary product suite. Both live scenarios and
the local Cloudflare-pool fixture/authorization tests passed. The previews
and test DB remain available for review; remove these named test resources
after the experiment is no longer needed.
