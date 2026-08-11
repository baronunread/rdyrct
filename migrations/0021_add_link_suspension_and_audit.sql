-- Admin moderation: suspend a link, and record who did what (#67).
--
-- Until now the only answer to an abuse report was deleting the whole
-- organization. That destroys a possibly-legitimate customer's other links to
-- deal with one bad one, and it cannot be undone.
--
-- A shortener is phishing infrastructure by default. How fast and how
-- precisely we can answer a report is what keeps rdyrct.com off blocklists,
-- and rdyrct.com on Safe Browsing breaks every free-plan link at once.
--
-- suspended_at NULL means active. One flag on the link covers every address
-- it answers to, so suspending does not have to chase aliases.
--
-- Suspension is reversible and deletion is not, which is the whole point: the
-- row stays, its clicks stay, and an appeal is possible.

ALTER TABLE links ADD COLUMN suspended_at INTEGER;
ALTER TABLE links ADD COLUMN suspended_by TEXT REFERENCES user(id) ON DELETE SET NULL;
ALTER TABLE links ADD COLUMN suspend_reason TEXT;

-- Partial index: the admin list filters on "currently suspended", which is
-- expected to be a tiny slice of the table, and a partial index costs nothing
-- for the rows that are not in it.
CREATE INDEX idx_links_suspended ON links (suspended_at) WHERE suspended_at IS NOT NULL;

-- Every privileged mutation, appended and never updated.
--
-- Deliberately small. #22 covers the larger admin identity work (immutable
-- root id, roles, MFA) and should build on this table rather than adding a
-- second one.
--
-- actor_user_id has no foreign key on purpose: an admin account can be
-- deleted, and the record of what they did must outlive them. Same reasoning
-- for target_id, which points at rows this table exists to remember the
-- deletion of.
CREATE TABLE admin_actions (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  -- e.g. 'link.suspend', 'link.unsuspend', 'org.suspend_links', 'user.ban'
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  -- Free-form JSON: the reason, counts, whatever the action needs to be
  -- understood later without joining to rows that may be gone.
  detail TEXT,
  created_at INTEGER NOT NULL
);

-- The log is read newest-first, and filtered by target when investigating one
-- link or org.
CREATE INDEX idx_admin_actions_created ON admin_actions (created_at DESC);
CREATE INDEX idx_admin_actions_target ON admin_actions (target_type, target_id);
