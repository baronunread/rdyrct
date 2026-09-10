# Incident: Cloudflare Queues daily operation cap exhausted

- **Date:** 2026-09-10
- **Detected:** ~22:40 UTC (Cloudflare email + owner noticed link edits failing)
- **Window:** 21:36 UTC (queue frozen) to 00:00 UTC (quota reset), 2026-09-10
- **Severity:** partial outage. Redirects kept serving; link create/edit/delete/suspend
  returned 500 to users; click analytics and KV follow-up writes stalled.
- **Trigger:** one free account using the shortener for SMS phishing.

## What happened

A free account (`redacted@example.com`, "name redacted") signed up at 17:17 UTC
and created a link to a phishing redirect chain (`bitly.cx`) 48 seconds later. A second
phishing link (`smsg.us`) went up at 21:01. The two links took **3,388 redirects** on
2026-09-10 against a baseline of ~35 redirects/day.

Every redirect on an org-owned link enqueues one click message, and delivering a message
costs ~3 Cloudflare Queues operations (1 write + 1 read + 1 delete; batches never fill at
our volume, so batching saves nothing). 3,388 redirects plus normal traffic came to
**10,175 queue operations**, past the Workers Free plan's **10,000 operations/day** cap.

At 21:36 UTC Cloudflare stopped processing both queues for the rest of the UTC day:

- `STORAGE_QUEUE.sendBatch()` and `CLICK_QUEUE.send()` returned HTTP 429 "Too Many Requests".
- The queue consumer stopped being invoked (no reads/deletes after 21:36).
- Queue analytics stopped reporting at the same minute, so the dashboard showed a flatline
  rather than a spike.

`enqueueStorage()` catches the send failure, records the work to `storage_outbox`, then
**rethrows**. Link mutation routes have no catch, so the 429 surfaced as a 500. D1 was
already committed, so each mutation was real and visible on refresh, but the KV follow-up
sat in the outbox. Click sends are best-effort (`enqueueClick` swallows failures), so
clicks from 21:36 to 00:00 UTC were dropped silently with no outbox row.

## Resolution

- Banned the account (`PATCH /api/admin/users/:id { banned: true }`).
- Deleted the two links. Their KV keys were gone centrally but edge cache kept serving the
  redirect for ~30 min; a manual `wrangler kv key delete` forced global invalidation and
  both went to 404.
- Queue processing resumed on its own at the 00:00 UTC quota reset.
- `storage_outbox` (10 rows) drained at the 06:00 UTC cron.

## Impact

- ~2.5 h where link create/edit/delete/suspend returned 500 (writes still succeeded).
- Click analytics lost for the same window, unrecoverable.
- Up to ~8 h where a handful of deleted/edited links served stale KV (dead links still
  redirecting, edited links serving the old destination) until the daily outbox drain.
- No redirect downtime for existing, unchanged links.

## Root causes

1. **No abuse prevention on link creation.** A verified free account created a phishing
   link 48 s after signup. `risk.ts` scores destinations but never blocks, there is no
   new-account link cap, and no per-org redirect-rate ceiling. Nothing stopped one account
   from generating 100x the platform's entire traffic.
2. **Queues Free plan is a hard cliff for a redirect service.** Click volume is the
   dominant operation source and scales with traffic, wanted or not. 10,000 ops/day is
   ~3,300 redirects/day across the whole platform. There is no headroom and no overage,
   just a stop.
3. **No alerting.** We learned from a Cloudflare email and a user, hours after the freeze.
   Nothing watches queue operation volume or the daily cap.
4. **A durable-write success still returns an error.** Once `enqueueStorage` has recorded
   the work to the outbox, the mutation is safe. Rethrowing turns a handled degradation
   into a user-visible 500.
5. **The outbox drains once a day.** `drainStorageOutbox` runs only from the 06:00 UTC
   cron, so any transient queue failure means up to ~30 h of stale KV.

## Follow-up

| Issue                                                                                                             | Root cause | Priority |
| ----------------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| [#224](https://github.com/baronunread/rdyrct/issues/224) Block or throttle abusive link creation                  | 1          | P1       |
| [#225](https://github.com/baronunread/rdyrct/issues/225) Take Queues off the Free plan cliff                      | 2          | P1       |
| [#226](https://github.com/baronunread/rdyrct/issues/226) Alert on Queues operation volume                         | 3          | P2       |
| [#227](https://github.com/baronunread/rdyrct/issues/227) `enqueueStorage`: stop rethrowing once outbox is written | 4          | P2       |
| [#228](https://github.com/baronunread/rdyrct/issues/228) Drain `storage_outbox` more than once a day              | 5          | P2       |

## Timeline (UTC, 2026-09-10)

| Time   | Event                                                                      |
| ------ | -------------------------------------------------------------------------- |
| 17:17  | abuse account signs up                                                     |
| 17:18  | first phishing link created (`exf7j8t` -> `bitly.cx`)                      |
| 21:01  | second phishing link created (`9b4pdef` -> `smsg.us`)                      |
| 21:36  | 10,000 ops/day reached; Cloudflare freezes both queues; analytics flatline |
| 22:00  | first `enqueueStorage` 429 surfaces as a 500 on a link delete              |
| ~22:40 | detected                                                                   |
| 23:2x  | account banned, links deleted, KV keys purged, redirects 404               |
| 00:00  | quota resets, queues resume                                                |
| 06:00  | `storage_outbox` drains                                                    |
