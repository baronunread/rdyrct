-- Public abuse reports against a short link, and the "needs review" flag the
-- abuse sweep and the report threshold both set on an org.
--
-- link_id and org_id are null when the reported address matched nothing. The
-- report is stored anyway so the form answers the same either way and does
-- not tell a visitor which slugs exist. No reporter address is stored; the
-- contact is only what the reporter chose to type.
CREATE TABLE link_reports (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  link_id TEXT REFERENCES links(id) ON DELETE SET NULL,
  org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_link_reports_link ON link_reports(link_id);
CREATE INDEX idx_link_reports_status ON link_reports(status, created_at);

ALTER TABLE orgs ADD COLUMN review_flagged_at INTEGER;
-- When an admin last cleared the org (restored it or marked it reviewed).
ALTER TABLE orgs ADD COLUMN cleared_at INTEGER;
