# Storage recovery

D1 is the source of truth. KV serves redirects, and R2 stores QR logos. A write
that touches more than one store commits D1 first, then hands the KV or R2
follow-up to a Cloudflare Queue. Multi-step external work runs as a Cloudflare
Workflow: org teardown and custom-domain activation each get one.

This doc covers both the storage queue (issue #15) and the custom-domain
activation workflow (issue #28), because they share the same Workflow and
Queue machinery and the same "D1 is truth, everything else is a resumable
follow-up" rule.

## How writes work

A request handler commits its D1 change, then awaits a send to the storage
queue (`STORAGE_QUEUE`) before returning. If the send itself fails, the await
throws, the request fails, and the client sees it: a producer-side drop is
never silent. Once Cloudflare accepts the message, the queue consumer runs it,
and Cloudflare Queues own the retry, backoff, and dead-letter behavior, so we
do not track attempts or next-retry times ourselves.

There are three message shapes:

- `kv_sync` names one KV key. The consumer reads the current D1 truth for that
  key and writes the value or deletes the key to match.
- `r2_delete` names one QR logo object to delete.
- `r2_delete_prefix` names an org's logo prefix to delete.

Every message is safe to run more than once. `kv_sync` is also safe to run out
of order: because the consumer always reads the current D1 row, the last message
for a key lands on the current D1 state whichever order the messages ran in. An
old "publish" message replayed after a link is deleted still deletes the key,
because D1 no longer has the row. This replaces the old revision bookkeeping.

## The gap we accept, and why

We trust the queue rather than adding a sweep that double-checks it. Awaiting
the send closes the classic dual-write gap at the one point that used to be
silent: a failed `sendBatch` now fails the request instead of vanishing.
Everything after that is Cloudflare Queues' job, and it has a real retry
budget (backoff across `max_retries` deliveries) before it gives up.

The one thing that survives: a message can still exhaust that budget and land
on the dead-letter queue, because we chose a bounded `max_retries` rather than
infinite retry. We do not repair that automatically. `rdyrct-storage-dlq` has
its own consumer (the same Worker, routed by queue name) whose only job is to
log the give-up and ack it: see [Dead letters](#dead-letters). No cron
re-derives D1 state against KV or R2 to paper over it. If a give-up needs a
fix, that is a manual `kv_sync`/`r2_delete` re-send once the underlying cause
(a KV outage, a bug) is understood, not an automatic sweep.

## Delete flows

Link deletion commits the D1 delete, then enqueues a `kv_sync` for the link's key
(the consumer finds no row and deletes it) and an `r2_delete` for its logo, if any.

Domain deletion removes the Cloudflare custom hostname, commits the D1 delete,
then enqueues a `kv_sync` for the domain key.

Logo replacement commits the new D1 URL, then enqueues an `r2_delete` for the old
object. Uploads are immutable and precede the row update: the client only ever
learns a logo's URL after the R2 `put` already succeeded, so a D1 row can only
reference a real object.

One gap this accepts: an upload that succeeds in R2 but whose URL never makes
it into a D1 row (the user abandons the edit before saving) leaves an orphaned
R2 object nothing deletes. There is no sweep that lists R2 and cross-checks D1
for unreferenced objects anymore. That costs storage, never correctness, so we
leave it.

## Org deletion (a Workflow)

Org teardown is a multi-step, ordered process, so it runs as a Cloudflare
Workflow (`ORG_DELETE`, class `OrgDeleteWorkflow`). Creating the instance is the
single commit point: if the request fails to create it, the org is fully intact
and the user can retry. Once created, Workflows runs every step to completion and
retries each step on its own.

The steps run in this order:

1. **gather**: read the org's Cloudflare hostname ids and KV keys while the org
   row still exists, and persist them in the workflow state.
2. **d1-delete**: delete the org row. Foreign-key cascades remove its links,
   domains, members, and invites. This comes right after gather so the org is
   irreversibly gone before the slower cleanup steps run.
3. **cf-hostnames**: delete each Cloudflare for SaaS custom hostname.
4. **kv-delete**: delete every gathered KV key.
5. **r2-prefix**: delete the org's `{orgId}/` logo prefix.

Every step is idempotent, so a retry is always safe. Workflows retries a
failing step with its own backoff independent of the storage queue; if the KV
or R2 step still exhausts that, the org is already gone from D1 and the
orphaned KV keys or R2 objects are left behind with nothing that sweeps for
them. That instance shows as errored in the Workflows dashboard, which is the
signal to intervene by hand.

A narrower, permanent gap: a link or domain created in the window between
gather and d1-delete was never in the gathered KV key list, so it cascades out
of D1 without its KV entry ever being deleted. This is the same kind of gap
custom-domain activation accepts below, not a case we sweep for.

## Custom-domain activation (a Workflow)

Adding a custom domain used to create the Cloudflare hostname inside the request
and poll its DNS and TLS state on every list read, so a GET could change provider
state and write D1. Activation now runs as a Cloudflare Workflow
(`DOMAIN_ACTIVATE`, class `DomainActivateWorkflow`). Reads stay pure and provider
latency stays off the user's request.

### Creating a domain

`POST /api/orgs/:orgId/domains` commits the D1 row in `checking_dns` with no
Cloudflare hostname yet, then creates one workflow instance keyed by the row id
and returns. The request never calls Cloudflare. If the instance cannot start,
the route deletes the row and returns 502, so the user retries a clean slate
rather than a domain stuck with no worker driving it.

### The steps

1. **ensure-hostname**: get-or-create the Cloudflare custom hostname, then save
   its id in D1.
2. **probe** (a loop): advance the domain one step, `checking_dns` ->
   `issuing_tls` -> `active`, sleeping between checks. Fast at first (a
   pre-created CNAME resolves in seconds), then a steady five-minute interval.
3. **publish-kv**: enqueue the `kv_sync` that publishes the domain's redirect
   key, as its own step so a failed publish retries without redoing the checks.

### No duplicate hostnames

A `step.do` callback re-runs in full on failure. If create succeeded but saving
its id did not, a naive retry would create a second custom hostname for the same
domain. `ensure-hostname` is get-or-create to stop that: it returns the saved id
when D1 already holds one, else it lists the zone's custom hostnames filtered by
name and reuses an existing one, and only creates when the zone truly has none.
Keying the instance by the domain row id also stops a duplicate create request
from spawning a second activation. Together these make the step safe to retry any
number of times.

We chose list-then-create over create-then-catch-duplicate on purpose. It does
not lean on the exact error Cloudflare returns for a duplicate hostname, which we
could not pin down from their docs. Only one workflow instance runs per domain
(keyed by row id) and the `domains.hostname` column is unique, so no concurrent
creator can race the lookup.

### Bounded, not forever

A domain that never resolves DNS or never gets a certificate must not poll
forever. Each probe checks a 24-hour deadline from the row's `created_at`; past
it, the domain lands in `error` with a stored `status_reason` the UI and admins
can read. A day covers real DNS propagation and certificate validation.
`step.sleep` does not count toward the Workflow step limit, and the deadline
bounds the loop.

### Reads are pure

`GET /` returns the stored rows. `POST /:id/refresh` returns the current row too.
Neither calls Cloudflare or writes D1 or KV. The frontend shows whatever status
the workflow last wrote, and it already polls the list while a domain is still
transitional.

### Deleting a domain

Deletion stays a plain request, not a workflow: one Cloudflare call and one D1
delete do not need durable steps. `DELETE /:id` removes the Cloudflare hostname
(looking it up by name when the row never recorded an id, which can happen if a
delete races an in-flight activation), tolerates the hostname already being gone,
deletes the D1 row, and enqueues the `kv_sync` that drops the redirect key.
`ensure-hostname` covers the other side: if the row vanished while it was
creating the hostname, it deletes the hostname it just made. So add-then-delete
leaves nothing orphaned.

### Gaps we accept

Two narrow gaps, both permanent, neither swept for:

- A domain whose D1 row says `active` but whose Cloudflare hostname never truly
  reached active (the workflow died in a bad spot). Nothing re-checks Cloudflare
  against D1 after the fact.
- A Cloudflare hostname created just after a delete removed the D1 row, past the
  compensation window. Nothing on our side lists zone hostnames to find one with
  no backing row.

Closing either would need a job that lists the zone's custom hostnames and
compares them against D1. We have not built it, and there is no cron left to
hang it off of: both are rare, and an orphaned hostname costs nothing but a
stray zone entry.

## Dead letters

A message that runs out of deliveries moves to the dead-letter queue
(`rdyrct-storage-dlq`). That queue has its own consumer: the same Worker,
routed by queue name in the `queue()` handler (`batch.queue.endsWith("-dlq")`).
`logDeadLetterBatch` logs a `storage_message_gave_up` line naming the op and
target, sends the same event to Better Stack (`alertBetterStack`, best-effort,
never throws), then acks. Nothing re-drives it and nothing repairs the drift
it represents.

That is deliberate, not an oversight. We trust Cloudflare Queues' retry and
backoff to recover from anything transient; a message that still exhausts
`max_retries` is rare enough, and specific enough to its cause (a real,
sustained outage or a bug in `applyStorageMessage`), that fixing it should mean
looking at the alert and understanding why, not an automatic sweep re-deriving
D1 state over it on a schedule. Recovery from a give-up is a manual re-send
once the cause is understood.

Visibility is the log and the alert. The main consumer logs
`storage message failed` on every failed try, and on a message's last delivery
it logs a `storage_message_dead_letter` line. The dead-letter consumer logs
`storage_message_gave_up` once the message actually lands there, and pushes
that same event to Better Stack over its HTTP source
(`BETTERSTACK_SOURCE_TOKEN`/`BETTERSTACK_INGEST_URL`; unset means the alert
silently no-ops, which is the case in dev and tests). Read the logs with
`wrangler tail` or in Cloudflare observability either way.

## Local development

`bun run dev` (Wrangler/Miniflare) runs the storage queue, its main consumer,
the dead-letter queue and its consumer, and both Workflows (org teardown and
domain activation) locally, so the whole path works without cloud resources.
`DEV_FAKE_CF=1` fakes the Cloudflare hostname calls, so the domain workflow
reaches `active` on its own in about ten seconds (the fake resolves DNS at ~5s
and issues TLS at ~8s). The Explorer API at
`http://localhost:5173/cdn-cgi/explorer/api` exposes local KV, R2, D1, Durable
Objects, and Workflows for inspection. Queues have no Explorer surface yet;
follow their effect through KV and R2 instead, and watch the dev log for
`storage_message_dead_letter` and `storage_message_gave_up` lines.

To run the daily click-retention cron by hand:

```sh
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=0+6+*+*+*"
```

Caveat: local queue delivery and Workflow execution are simulations. Retry timing
and backoff do not match production exactly, and a Worker reload can drop
in-flight local messages. Treat local runs as functional checks, not timing tests.

## Failure tests

`tests/worker/storage.worker.ts` injects failures at the queue, KV, and R2
boundaries:

- A `kv_sync` publishes from D1, is safe to run twice, deletes when the row is
  gone (including a stale message replayed after a delete), and converges on the
  latest value whichever sync runs last.
- The consumer retries a message when KV or R2 is down, then acks once the store
  recovers.
- The consumer logs `storage_message_dead_letter` only on a message's last
  delivery, so the log flags a real give-up and not every failed try.
- The dead-letter consumer logs `storage_message_gave_up` and acks every
  message it receives, for both message shapes, and posts the same events to
  Better Stack when configured (and does nothing, without throwing, when it
  is not).
- `enqueueStorage` propagates a producer-side send failure instead of
  swallowing it, so a route handler that awaits it actually fails the request.
- Org teardown gathers keys, removes the org from D1, and keeps the KV and R2
  cleanup steps durable and idempotent under a full secondary-store outage.

`tests/worker/domains.worker.ts` covers the activation workflow's step functions:

- `ensureHostname` creates a hostname once and saves its id, returns the saved id
  on a retry without calling Cloudflare, and, when a create succeeded but its id
  was lost, finds the existing hostname instead of creating a duplicate. It also
  compensates by deleting the hostname when the domain row is removed
  mid-activation, and returns null when the domain is already gone.
- `probeDomain` advances `checking_dns` -> `issuing_tls` -> `active` one step at a
  time, holds while DNS is still pending, fails a domain past the 24-hour
  deadline with a stored reason, treats `active`/`error` as terminal, and reports
  a missing domain as gone.
- The `GET /` list and `POST /:id/refresh` routes leave a domain's status untouched
  and never call Cloudflare, so reads cannot mutate.

The Workflow classes and queue handler are thin wrappers over plain functions
(`orgDeleteGather`, `deleteKvKeys`, `deleteR2Prefix`, `ensureHostname`,
`probeDomain`, `applyStorageMessage`, `consumeStorageBatch`), so most tests
exercise that logic directly without needing the Workflows or Queues runtime to
drive it. The consumer-retry and dead-letter tests are the exception: they build
real `MessageBatch`es with `@cloudflare/vitest-pool-workers`'s
`createMessageBatch()` and read back ack/retry state with `getQueueResult()`, so
they exercise Cloudflare's actual queue delivery semantics rather than a
hand-rolled stand-in.
