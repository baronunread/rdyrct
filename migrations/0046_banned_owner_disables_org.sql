-- A banned owner's orgs are disabled as a whole: every link and custom
-- domain answers "disabled", and the daily cron deletes the org 90 days
-- after this was set. Null means not disabled.
ALTER TABLE orgs ADD COLUMN disabled_at INTEGER;

-- Owners banned before this: their orgs are disabled from now, so they get
-- the full 90 days like everyone else.
UPDATE orgs SET disabled_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (
  SELECT m.org_id FROM org_members m JOIN user u ON u.id = m.user_id
  WHERE m.role = 'owner' AND u.banned = 1
);

-- The ban used to suspend each link with this reason. The org's disabled_at
-- now does that job, and an unban clears it, so these suspensions would only
-- keep the links dark after an unban.
-- The org-wide flag goes too, but only where the ban was its only cause.
UPDATE orgs SET links_suspended_at = NULL
WHERE id IN (SELECT org_id FROM links WHERE suspend_reason = 'Owner banned')
  AND NOT EXISTS (
    SELECT 1 FROM links
    WHERE links.org_id = orgs.id AND links.suspended_at IS NOT NULL
      AND links.suspend_reason IS NOT 'Owner banned'
  );
UPDATE links SET suspended_at = NULL, suspended_by = NULL, suspend_reason = NULL
WHERE suspend_reason = 'Owner banned';
