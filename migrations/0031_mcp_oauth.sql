-- MCP OAuth (#139 follow-up): turns this app into an OAuth 2.1 authorization
-- server for MCP clients, alongside the API keys #130 already added. Shapes
-- and statement order (dependency order: oauth_client before anything that
-- references it, etc.) come straight from `bunx drizzle-kit generate`
-- against src/worker/db/schema.ts, not hand-typed.
CREATE TABLE jwks (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  alg TEXT,
  crv TEXT
);

CREATE TABLE oauth_resource (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  name TEXT NOT NULL,
  access_token_ttl INTEGER,
  refresh_token_ttl INTEGER,
  signing_algorithm TEXT,
  signing_key_id TEXT,
  allowed_scopes TEXT,
  custom_claims TEXT,
  dpop_bound_access_tokens_required INTEGER DEFAULT false NOT NULL,
  disabled INTEGER DEFAULT false NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  policy_version INTEGER DEFAULT 1 NOT NULL,
  metadata TEXT
);
CREATE UNIQUE INDEX oauth_resource_identifier_unique ON oauth_resource(identifier);

CREATE TABLE oauth_client (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  client_discovery_id TEXT,
  disabled INTEGER DEFAULT false NOT NULL,
  skip_consent INTEGER,
  enable_end_session INTEGER,
  subject_type TEXT,
  scopes TEXT,
  client_credentials_scopes TEXT DEFAULT '[]' NOT NULL,
  user_id TEXT REFERENCES user(id),
  created_at INTEGER,
  updated_at INTEGER,
  name TEXT,
  uri TEXT,
  icon TEXT,
  contacts TEXT,
  tos TEXT,
  policy TEXT,
  software_id TEXT,
  software_version TEXT,
  software_statement TEXT,
  redirect_uris TEXT NOT NULL,
  post_logout_redirect_uris TEXT,
  backchannel_logout_uri TEXT,
  backchannel_logout_session_required INTEGER,
  token_endpoint_auth_method TEXT,
  application_type TEXT,
  jwks TEXT,
  jwks_uri TEXT,
  grant_types TEXT,
  response_types TEXT,
  require_pkce INTEGER,
  dpop_bound_access_tokens INTEGER DEFAULT false NOT NULL,
  reference_id TEXT,
  metadata TEXT
);
CREATE UNIQUE INDEX oauth_client_client_id_unique ON oauth_client(client_id);
CREATE INDEX idx_oauth_client_user ON oauth_client(user_id);

CREATE TABLE oauth_client_resource (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES oauth_resource(identifier) ON DELETE CASCADE,
  metadata TEXT,
  created_at INTEGER
);
CREATE INDEX idx_oauth_client_resource_client ON oauth_client_resource(client_id);
CREATE INDEX idx_oauth_client_resource_resource ON oauth_client_resource(resource_id);
CREATE UNIQUE INDEX idx_oauth_client_resource_pair ON oauth_client_resource(client_id, resource_id);

CREATE TABLE oauth_refresh_token (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES oauth_client(client_id),
  session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  reference_id TEXT,
  authorization_code_id TEXT,
  resources TEXT,
  requested_user_info_claims TEXT,
  expires_at INTEGER,
  created_at INTEGER,
  revoked INTEGER,
  rotated_at INTEGER,
  rotation_replay_response TEXT,
  rotation_replay_expires_at INTEGER,
  auth_time INTEGER,
  confirmation TEXT,
  scopes TEXT NOT NULL
);
CREATE UNIQUE INDEX oauth_refresh_token_token_unique ON oauth_refresh_token(token);
CREATE INDEX idx_oauth_refresh_token_client ON oauth_refresh_token(client_id);
CREATE INDEX idx_oauth_refresh_token_session ON oauth_refresh_token(session_id);
CREATE INDEX idx_oauth_refresh_token_user ON oauth_refresh_token(user_id);
CREATE INDEX idx_oauth_refresh_token_auth_code ON oauth_refresh_token(authorization_code_id);

CREATE TABLE oauth_access_token (
  id TEXT PRIMARY KEY,
  token TEXT,
  client_id TEXT NOT NULL REFERENCES oauth_client(client_id),
  session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES user(id),
  reference_id TEXT,
  authorization_code_id TEXT,
  resources TEXT,
  requested_user_info_claims TEXT,
  refresh_id TEXT REFERENCES oauth_refresh_token(id),
  expires_at INTEGER,
  created_at INTEGER,
  revoked INTEGER,
  confirmation TEXT,
  scopes TEXT NOT NULL
);
CREATE UNIQUE INDEX oauth_access_token_token_unique ON oauth_access_token(token);
CREATE INDEX idx_oauth_access_token_client ON oauth_access_token(client_id);
CREATE INDEX idx_oauth_access_token_session ON oauth_access_token(session_id);
CREATE INDEX idx_oauth_access_token_user ON oauth_access_token(user_id);
CREATE INDEX idx_oauth_access_token_auth_code ON oauth_access_token(authorization_code_id);
CREATE INDEX idx_oauth_access_token_refresh ON oauth_access_token(refresh_id);

CREATE TABLE oauth_consent (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_client(client_id),
  user_id TEXT REFERENCES user(id),
  reference_id TEXT,
  resources TEXT,
  requested_user_info_claims TEXT,
  scopes TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX idx_oauth_consent_client ON oauth_consent(client_id);
CREATE INDEX idx_oauth_consent_user ON oauth_consent(user_id);

CREATE TABLE oauth_client_assertion (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
