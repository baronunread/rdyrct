-- Destination risk scoring (#68).
--
-- Nothing checked whether a link pointed somewhere malicious. Bad links
-- surfaced only when somebody reported them, and by then the shared domain
-- may already be on a blocklist.
--
-- Three columns, all null on existing rows, which is the correct starting
-- state: null means unscored, not clean. The cron picks up the nulls first,
-- so the whole table cycles without a backfill here.
--
-- risk_score    0 = nothing known against it, 100 = a provider refuses it.
--               An integer rather than a boolean because a second provider
--               will have degrees, and widening a boolean later is a
--               migration nobody enjoys.
-- risk_reasons  JSON array of short codes, e.g. ["dns_blocklist"].
-- risk_checked_at  ms epoch. Also the cron's queue order: oldest first.
-- risk_provider    which provider answered, so two of them can be compared
--                  on real traffic before anyone pays for the second.
--
-- Deliberately not indexed. The cron's `order by risk_checked_at` scan is a
-- daily job over a table measured in thousands of rows, and the admin list
-- (#67) filters by org first. Add an index when a query is actually slow,
-- not in anticipation.

ALTER TABLE links ADD COLUMN risk_score INTEGER;
ALTER TABLE links ADD COLUMN risk_reasons TEXT;
ALTER TABLE links ADD COLUMN risk_checked_at INTEGER;
ALTER TABLE links ADD COLUMN risk_provider TEXT;
