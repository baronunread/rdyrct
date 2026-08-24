-- #118: a repair path for storage work that D1 committed and the queue never
-- did.
--
-- Two holes, both after the mutation is already durable. A failed sendBatch
-- leaves KV serving the old value with nothing scheduled to fix it, and a
-- message that exhausts its retries is alerted on and acked, so the payload is
-- gone and the change cannot be replayed by hand.
--
-- A row here says "this key still needs applying". It carries no payload
-- beyond the op and its target, because every storage message is desired-state
-- (the consumer reads D1 and writes what it finds), so re-deriving the value
-- at drain time is both simpler and more correct than storing a stale one.
CREATE TABLE storage_outbox (
  id TEXT PRIMARY KEY,
  op TEXT NOT NULL,
  target TEXT NOT NULL,
  -- Why it landed here: 'send_failed' or 'gave_up'. Kept apart because they
  -- mean different things about the queue's health.
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- How many times the drain has tried, so a permanently broken row can be
  -- found instead of being retried forever in silence.
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);

-- One pending row per target: re-applying desired state twice is a no-op, so
-- a second failure for the same key should replace the first rather than
-- queueing a duplicate drain.
CREATE UNIQUE INDEX idx_storage_outbox_target ON storage_outbox(op, target);

-- The drain reads oldest-first in bounded batches.
CREATE INDEX idx_storage_outbox_created ON storage_outbox(created_at);
