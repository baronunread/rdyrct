-- Migration 0024: a fourth org role, `viewer`, that reads everything and
-- writes nothing (#157).
--
-- Both `role` columns carry a CHECK constraint, and SQLite cannot alter one,
-- so both tables are rebuilt. This follows 0003 (which rebuilt `domains`)
-- rather than 0008's rename-column trick, because 0008's warning is about
-- dropping a *parent* table: `DROP TABLE user` fires an implicit DELETE that
-- cascades into session/account/org_members. `org_members` and `invites` are
-- children only, referenced by nothing, so dropping them cascades nowhere.

DROP INDEX IF EXISTS idx_org_members_user;

CREATE TABLE org_members_new (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

INSERT INTO org_members_new (org_id, user_id, role, created_at)
  SELECT org_id, user_id, role, created_at FROM org_members;

DROP TABLE org_members;
ALTER TABLE org_members_new RENAME TO org_members;
CREATE INDEX idx_org_members_user ON org_members(user_id);

DROP INDEX IF EXISTS idx_invites_org;

CREATE TABLE invites_new (
  token TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  email TEXT,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

INSERT INTO invites_new (token, org_id, role, email, created_by, created_at, expires_at)
  SELECT token, org_id, role, email, created_by, created_at, expires_at FROM invites;

DROP TABLE invites;
ALTER TABLE invites_new RENAME TO invites;
CREATE INDEX idx_invites_org ON invites(org_id);
