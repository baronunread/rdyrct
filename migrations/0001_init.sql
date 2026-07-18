-- shrtnr initial schema

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX idx_org_members_user ON org_members(user_id);

CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_invites_org ON invites(org_id);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  destination TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  qr_logo TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_links_org ON links(org_id);

CREATE TABLE clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_clicks_link_ts ON clicks(link_id, ts);
CREATE INDEX idx_clicks_org_ts ON clicks(org_id, ts);
