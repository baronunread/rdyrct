-- Click rollups (#26): the read model analytics reads instead of raw clicks.
--
-- click_daily: clicks per org, UTC day and link. Totals, the daily chart, top
-- links, UTM breakdowns, dead and decaying links and the links list.
-- click_daily_dims: the same, split by one dimension at a time (country,
-- referrer or device). One row per value seen, not per combination of all
-- three: at volume the combinations multiply (a link-day with 50 countries,
-- 30 referrers and 4 devices has up to 6000 of them, against 84 rows here).
-- click_hourly: clicks per org, UTC hour and link. The last-24-hours chart
-- and the hour-of-week heatmap.
--
-- Keyed org first and WITHOUT ROWID, so the stats page reads one contiguous
-- range of the primary key, and each has a covering (link_id, ...) index for
-- the per-link page, the links list and the cascade when a link is deleted.
-- Every row belongs to a link and goes with it, as its raw clicks always did.
-- Raw-click retention does not touch these.
--
-- insertClicks (src/worker/clicks.ts) adds to all three in the same D1 batch
-- that writes the raw rows, counting only clicks whose dedupe id is not
-- already stored, so a redelivered click is counted once.
CREATE TABLE click_daily (
  org_id TEXT NOT NULL,
  -- UTC 'YYYY-MM-DD', the same key the stats series uses.
  day TEXT NOT NULL,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicks INTEGER NOT NULL,
  PRIMARY KEY (org_id, day, link_id)
) WITHOUT ROWID;
CREATE INDEX idx_click_daily_link ON click_daily(link_id, day, clicks);

CREATE TABLE click_daily_dims (
  org_id TEXT NOT NULL,
  dim TEXT NOT NULL CHECK (dim IN ('country', 'referrer', 'device')),
  day TEXT NOT NULL,
  value TEXT NOT NULL,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicks INTEGER NOT NULL,
  PRIMARY KEY (org_id, dim, day, value, link_id)
) WITHOUT ROWID;
CREATE INDEX idx_click_daily_dims_link ON click_daily_dims(link_id, dim, day, value, clicks);

CREATE TABLE click_hourly (
  org_id TEXT NOT NULL,
  -- Start of the UTC hour, in milliseconds like clicks.ts.
  hour INTEGER NOT NULL,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicks INTEGER NOT NULL,
  PRIMARY KEY (org_id, hour, link_id)
) WITHOUT ROWID;
CREATE INDEX idx_click_hourly_link ON click_hourly(link_id, hour, clicks);

-- Backfill from the clicks already stored, one INSERT ... SELECT per table:
-- fine at rdyrct.com's size (under 10k clicks). Each overwrites rather than
-- adds (excluded.clicks), so running it again gives the same rows, and a copy
-- with a much larger clicks table can run it by hand one range at a time (add
-- AND ts >= ? AND ts < ? to the WHERE, on whole UTC days) to the same result.
-- WHERE true is SQLite's required disambiguation before ON CONFLICT. org_id
-- is not grouped on: a link belongs to one org.
--
-- Apply this before deploying the worker that writes the rollups, as with
-- every migration. Clicks the old worker writes after the backfill and before
-- the new one is live are missing from the rollups until the backfill is run
-- again for that day.
INSERT INTO click_daily (org_id, day, link_id, clicks)
SELECT org_id, date(ts / 1000, 'unixepoch'), link_id, count(*)
FROM clicks WHERE true
GROUP BY link_id, date(ts / 1000, 'unixepoch')
ON CONFLICT (org_id, day, link_id) DO UPDATE SET clicks = excluded.clicks;

INSERT INTO click_daily_dims (org_id, dim, day, value, link_id, clicks)
SELECT org_id, dim, day, value, link_id, count(*) FROM (
  SELECT org_id, 'country' AS dim, date(ts / 1000, 'unixepoch') AS day, country AS value, link_id FROM clicks
  UNION ALL
  SELECT org_id, 'referrer', date(ts / 1000, 'unixepoch'), referrer, link_id FROM clicks
  UNION ALL
  SELECT org_id, 'device', date(ts / 1000, 'unixepoch'), device, link_id FROM clicks
) WHERE true
GROUP BY link_id, dim, day, value
ON CONFLICT (org_id, dim, day, value, link_id) DO UPDATE SET clicks = excluded.clicks;

INSERT INTO click_hourly (org_id, hour, link_id, clicks)
SELECT org_id, ts - ts % 3600000, link_id, count(*)
FROM clicks WHERE true
GROUP BY link_id, ts - ts % 3600000
ON CONFLICT (org_id, hour, link_id) DO UPDATE SET clicks = excluded.clicks;
