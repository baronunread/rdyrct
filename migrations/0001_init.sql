-- rdyrct initial schema
-- Auth tables (user/session/account/verification) follow the BetterAuth core
-- schema; timestamps there are epoch milliseconds.

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  -- Billing is per-user: one Free/Pro subscription per person.
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  polar_customer_id TEXT,
  polar_subscription_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_session_user ON session(user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_account_user ON account(user_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_verification_identifier ON verification(identifier);

-- App tables

CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- An org's plan is its owner's plan (see plan.ts); no plan column here.
  -- QR appearance defaults for the org's links; '' = built-in default.
  qr_logo TEXT NOT NULL DEFAULT '',
  qr_style TEXT NOT NULL DEFAULT '',
  qr_color TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX idx_org_members_user ON org_members(user_id);

CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  email TEXT,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_by TEXT REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX idx_invites_org ON invites(org_id);

CREATE TABLE domains (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error')),
  root_redirect TEXT NOT NULL DEFAULT '',
  cf_hostname_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_domains_org ON domains(org_id);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  domain_id TEXT REFERENCES domains(id),
  slug TEXT NOT NULL,
  destination TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  qr_logo TEXT NOT NULL DEFAULT '',
  -- Per-link QR appearance overrides; '' = inherit the org's defaults.
  qr_style TEXT NOT NULL DEFAULT '',
  qr_color TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_links_org ON links(org_id);
-- slugs are unique per domain; NULL domain_id (the shared domain) folds to ''
CREATE UNIQUE INDEX idx_links_domain_slug ON links(ifnull(domain_id, ''), slug);

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
