-- #344: a link can carry a warning. It still works, but a visitor sees the
-- destination host and a Continue button first. Set by an open report, by the
-- abuse sweep for a new free org with unusual traffic, or by an admin. Null
-- means no warning. The reason is for the admin; no visitor ever sees it.
ALTER TABLE links ADD COLUMN warned_at INTEGER;
ALTER TABLE links ADD COLUMN warn_reason TEXT;

-- #341: when Google Web Risk last answered for this destination. Separate
-- from risk_checked_at, which the redirect path refreshes from the DNS check
-- every day, so the weekly rescan can tell which links Web Risk has not seen.
ALTER TABLE links ADD COLUMN web_risk_checked_at INTEGER;
