-- Better Auth 1.7 identifies provider accounts by issuer plus account ID.
-- rdyrct only supports credential accounts, so every existing account belongs
-- to Better Auth's documented local credential issuer.
CREATE TABLE account_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
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

INSERT INTO account_new (
  id, account_id, issuer, provider_id, user_id, access_token, refresh_token,
  id_token, access_token_expires_at, refresh_token_expires_at, scope, password,
  created_at, updated_at
)
SELECT
  id, account_id, 'local:credential', provider_id, user_id, access_token,
  refresh_token, id_token, access_token_expires_at, refresh_token_expires_at,
  scope, password, created_at, updated_at
FROM account;

DROP TABLE account;
ALTER TABLE account_new RENAME TO account;
CREATE INDEX idx_account_user ON account(user_id);
CREATE UNIQUE INDEX idx_account_issuer_account_id ON account(issuer, account_id);
