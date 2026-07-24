# Click ingestion

Redirect latency and availability are the product. A redirect never writes to
D1 itself: it enqueues a compact click event to `CLICK_QUEUE` and returns.
Cloudflare Queues buffer whatever a traffic spike throws at it, and a
consumer turns each batch into one multi-row D1 insert, so a spike costs one
write per batch instead of one write per click.

This is the same queue/DLQ shape [storage recovery](storage-recovery.md)
uses, but a different consistency model: storage messages are a
correctness-critical follow-up to a D1 write that already happened, so a
producer-side failure fails the request. A click is the analytics itself, and
losing some under overload is the accepted tradeoff (issue #16), so its
producer never fails the request.

## How it works

`redirectWithClick` (`src/worker/index.ts`) calls `enqueueClick`
(`src/worker/clicks.ts`) inside `waitUntil`, after the redirect response is
already on its way. `enqueueClick`:

1. Checks `clickAnalyticsAllowed` (`RL_CLICK_RECORDING`, 600/min per org, fails
   closed). Over the limit, it returns without enqueuing anything.
2. Builds a `ClickMessage` with a producer-assigned `dedupeId`
   (`crypto.randomUUID()`) and sends it to `CLICK_QUEUE`.
3. Catches and logs its own failures instead of throwing. A full queue, a
   Cloudflare Queues outage, or the rate limit all fall through to the same
   place: the click is dropped, the redirect is unaffected.

The consumer, `consumeClickBatch`, inserts every message in a batch as one
`INSERT ... VALUES (...), (...), ...` statement, with
`onConflictDoNothing()` targeting the unique `dedupe_id` column. A redelivery
of a message that already landed inserts nothing for that row. The batch acks
or retries as a unit (`batch.ackAll()` / `batch.retryAll()`), matching the
insert: either every row in the statement lands or none does.

## The batch failure tradeoff

A `dedupe_id` collision is silently skipped, but a **foreign key** violation
(a message naming a `linkId` that no longer exists, because the link was
deleted between the redirect and the consumer running) fails the whole
statement, and with it every other row in that batch. The batch retries as a
unit; if the link stays gone, the whole batch eventually dead-letters
together, not just the one bad row.

This is a deliberate simplification, not an oversight: splitting a failed
batch to save the surviving rows would mean re-running smaller and smaller
inserts until the bad row is isolated, extra machinery for a rare case
(a link deleted in the narrow window between a redirect and the next queue
flush) whose cost is a handful of dropped clicks, which the ingestion path
already treats as acceptable under overload. We trust Cloudflare Queues'
retry budget here the same way `storage.ts` does for KV/R2 follow-ups.

## Dead letters

A batch that exhausts `rdyrct-clicks`'s retries lands on `rdyrct-clicks-dlq`,
which this same Worker also consumes (routed by queue name in the `queue()`
handler in `src/worker/index.ts`, checking `-clicks-dlq` ahead of the generic
`-dlq` suffix since it ends with both). `logClickDeadLetterBatch` logs a
`click_dropped` line per message, alerts Better Stack the same way the
storage DLQ does (best-effort, no-ops unconfigured), then acks. Nothing
re-drives it: a dropped click is gone, and re-deriving it from anywhere is
not possible, unlike a `kv_sync` message which can be recovered by touching
the row again.

## Retention

The daily cron (`scheduled` in `src/worker/index.ts`) still trims clicks
older than 400 days in bounded 1000-row batches. That is unchanged: it deletes
by age, not by how a row arrived, so it runs the same whether a row came from
the old direct-insert path or the queue.

## Local development

`bun run dev` runs `rdyrct-clicks` and `rdyrct-clicks-dlq` locally the same
way it runs the storage queues (see [Local development](storage-recovery.md#local-development)
in the storage-recovery doc): functional checks, not timing tests, and a
Worker reload can drop in-flight local messages.

## Tests

`tests/worker/clicks.worker.ts` covers the consumer and dead-letter paths
using real `MessageBatch`es (`createMessageBatch()` / `getQueueResult()`, the
same helpers `storage.worker.ts` uses): a batch insert lands every row in one
statement, a redelivered `dedupeId` does not double-insert, a batch containing
a bad `linkId` retries as a unit and recovers once the bad message is gone,
and `click_batch_dead_letter` / `click_dropped` log only when they should.

`tests/worker/redirects.worker.ts` covers the producer at the HTTP layer: a
redirect enqueues one message with the right `linkId`/`orgId`, a
rate-limited org enqueues nothing, and a queue-send failure still lets the
redirect through.
