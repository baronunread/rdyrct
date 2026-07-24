-- Click ingestion moves onto a queue (issue #16): the consumer batches inserts
-- and needs a producer-assigned id to dedupe a redelivered message. Nullable
-- so existing rows need no backfill; SQLite's unique index allows any number
-- of NULLs, so they never collide.

ALTER TABLE clicks ADD COLUMN dedupe_id TEXT;
CREATE UNIQUE INDEX idx_clicks_dedupe_id ON clicks(dedupe_id);
