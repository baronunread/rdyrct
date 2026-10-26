-- Clicks dropped past an org's monthly cap (#387), counted per link per
-- minute so the abuse sweep (src/worker/abuse.ts) still sees them.
--
-- Past its cap an org's clicks are not stored, so a check that counts rows in
-- `clicks` reads zero for it until the 1st. Without this table an org could
-- spend its allowance quietly and then send any volume it liked with nothing
-- in the 24-hour ceiling, the one-hour burst check or the new-link check.
--
-- The flush adds to it in the same batch as the stored clicks: one upsert per
-- link-minute in the flush, not one row per click. The daily cron deletes rows
-- older than two days; the sweep reads 24 hours at most. No foreign keys: a
-- row for a link or org deleted since is harmless, ages out in two days, and
-- must not fail the batch that records everybody else's clicks.
CREATE TABLE click_overflow (
  -- Start of the UTC minute, in milliseconds.
  minute INTEGER NOT NULL,
  org_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  PRIMARY KEY (minute, org_id, link_id)
) WITHOUT ROWID;
