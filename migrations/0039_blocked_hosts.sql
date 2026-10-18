-- Destination hosts nobody may point a link at, fed by an admin marking an
-- org as abuse (or adding one by hand). Matched on the exact hostname without
-- "www.", so a scam kit cannot simply be redeployed under a new account.
CREATE TABLE blocked_hosts (
  host TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
