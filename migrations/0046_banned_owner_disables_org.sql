-- A banned owner's orgs are disabled as a whole: every link and custom
-- domain answers "disabled", and the daily cron deletes the org 90 days
-- after this was set. Null means not disabled.
ALTER TABLE orgs ADD COLUMN disabled_at INTEGER;

-- Owners banned before this: their orgs are disabled from now, so they get
-- the full 90 days like everyone else.
--
-- Nothing else happens here. This runs before the new Worker is deployed,
-- and the old one would undo the rest: its outbox drain drops an op it does
-- not know, and its KV sync would publish a link live the moment its old
-- "Owner banned" suspension went. The new Worker's daily cron does both
-- (settleBannedOrgs in abuse-hold.ts).
UPDATE orgs SET disabled_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (
  SELECT m.org_id FROM org_members m JOIN user u ON u.id = m.user_id
  WHERE m.role = 'owner' AND u.banned = 1
);
