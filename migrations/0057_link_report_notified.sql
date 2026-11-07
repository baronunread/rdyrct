-- When the platform admin was mailed about this report. At most one report
-- mail goes out per hour (routes/reports.ts): the report that won the hour
-- carries the time, and the next mail counts the reports that came in since.
-- Without the cap, anyone could report a thousand links and send a thousand
-- mails.
ALTER TABLE link_reports ADD COLUMN notified_at INTEGER;
CREATE INDEX idx_link_reports_notified ON link_reports(notified_at) WHERE notified_at IS NOT NULL;
