-- Tracked clicks per org per UTC calendar month (#387).
--
-- Each plan records up to PLAN_LIMITS[plan].trackedClicks clicks a month per
-- org. Past that, links keep redirecting and the clicks are not recorded.
-- This is the exact count the cap is checked against: insertClicks
-- (src/worker/clicks.ts) adds to it in the same D1 batch as the raw rows and
-- the rollups, counting only clicks whose dedupe id is not already stored, so
-- a redelivered click is counted once. The flush reads one row per org per
-- month and never scans `clicks`.
--
-- warned_limit and capped_limit record which cap the 80% and 100% emails went
-- out for, so each goes once per org per month (and once more if a plan
-- change moves the cap).
CREATE TABLE org_click_usage (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- UTC 'YYYY-MM'.
  month TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  warned_limit INTEGER,
  capped_limit INTEGER,
  PRIMARY KEY (org_id, month)
) WITHOUT ROWID;
-- The cron's "who is near their cap this month" read.
CREATE INDEX idx_org_click_usage_month ON org_click_usage(month, clicks);

-- This month so far, from the clicks already stored, so an org part-way
-- through a month does not start it again at zero. Earlier months need no
-- row: nothing reads them. Overwrites rather than adds, so it is safe to run
-- again after the deploy for clicks the old worker wrote in between.
INSERT INTO org_click_usage (org_id, month, clicks)
SELECT org_id, strftime('%Y-%m', ts / 1000, 'unixepoch'), count(*)
FROM clicks
WHERE ts >= CAST(strftime('%s', 'now', 'start of month') AS INTEGER) * 1000
GROUP BY org_id, strftime('%Y-%m', ts / 1000, 'unixepoch')
ON CONFLICT (org_id, month) DO UPDATE SET clicks = excluded.clicks;
