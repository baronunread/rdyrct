-- Scoped API keys (#131, minimal form): the credential a remote MCP client
-- authenticates with (#139), since a browser session cookie cannot reach one.
-- Bound to a user, exactly like a session: an org's own role check
-- (requireOrgRole) still decides what the key may do in each org, so no
-- separate scope table is needed yet.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
