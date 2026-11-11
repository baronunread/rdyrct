-- #489: the daily dedupe sweep (sweepDedupeIds in src/worker/clicks.ts) asks
-- for clicks that still carry a dedupe id and are older than a day. Through
-- idx_clicks_ts that walks every click older than the cutoff, up to 400 days
-- of history, on each loop. Only about a day of rows ever carries a dedupe id,
-- so an index over just those rows keeps the sweep proportional to what it
-- clears.
CREATE INDEX idx_clicks_live_dedupe_ts ON clicks(ts) WHERE dedupe_id IS NOT NULL;
