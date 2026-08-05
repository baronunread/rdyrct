-- Durable ledger of processed Polar webhook deliveries (#17): the `webhook-id`
-- header (Svix-style delivery id, unique per attempt including retries of the
-- same logical event) is the idempotency key, so a duplicate delivery can be
-- recognized and skipped instead of re-applied.
CREATE TABLE polar_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  payload_hash TEXT NOT NULL
);
