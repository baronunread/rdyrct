-- Destination risk scoring (#68).
--
-- Nothing checked whether a link pointed somewhere malicious. Bad links
-- surfaced only when somebody reported them, and by then the shared domain
-- may already be on a blocklist.
--
-- Three columns, all null on existing rows, which is the correct starting
-- state: null means unscored, not clean. Nothing backfills them: a link is
-- scored when it is created, when its destination changes, and when somebody
-- clicks it and the answer has gone stale. A link nobody ever clicks stays
-- unscored, which is fine, because it is also a link nobody ever visits.
--
-- risk_score    0 = nothing known against it, 100 = a provider refuses it.
--               An integer rather than a boolean because a second provider
--               will have degrees, and widening a boolean later is a
--               migration nobody enjoys.
-- risk_reasons  JSON array of short codes, e.g. ["dns_blocklist"].
-- risk_checked_at  ms epoch. Read on a click to decide whether the verdict
--                  is stale enough to check again.
-- risk_provider    which provider answered, so two of them can be compared
--                  on real traffic before anyone pays for the second.
--
-- Deliberately not indexed. Nothing scans by this column: the freshness check
-- happens per click against a hostname cache in KV, and the admin list (#67)
-- filters by org first. Add an index when a query is actually slow, not in
-- anticipation.

ALTER TABLE links ADD COLUMN risk_score INTEGER;
ALTER TABLE links ADD COLUMN risk_reasons TEXT;
ALTER TABLE links ADD COLUMN risk_checked_at INTEGER;
ALTER TABLE links ADD COLUMN risk_provider TEXT;
