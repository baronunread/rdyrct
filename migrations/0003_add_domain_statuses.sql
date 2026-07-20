-- Migration 0003: Broaden domain status for the DNS→TLS activation pipeline.
-- "pending" is replaced by "checking_dns" and "issuing_tls".

DROP INDEX IF EXISTS idx_domains_org;

CREATE TABLE domains_new (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'checking_dns' CHECK (status IN ('checking_dns', 'issuing_tls', 'active', 'error')),
  root_redirect TEXT NOT NULL DEFAULT '',
  cf_hostname_id TEXT,
  created_at INTEGER NOT NULL
);

INSERT INTO domains_new (id, org_id, hostname, status, root_redirect, cf_hostname_id, created_at)
  SELECT id, org_id, hostname,
    CASE WHEN status = 'pending' THEN 'checking_dns' ELSE status END,
    root_redirect, cf_hostname_id, created_at
  FROM domains;

DROP TABLE domains;
ALTER TABLE domains_new RENAME TO domains;
CREATE INDEX idx_domains_org ON domains(org_id);
