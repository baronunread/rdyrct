-- Swept clicks have no dedupe id and cannot be redelivered. Keep only the
-- live seven-day dedupe window in the unique index instead of every retained
-- click. Rebuilding the index does not rewrite the clicks table.
DROP INDEX idx_clicks_dedupe_id;
CREATE UNIQUE INDEX idx_clicks_dedupe_id ON clicks(dedupe_id) WHERE dedupe_id IS NOT NULL;
