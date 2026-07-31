-- Group custom-domain addresses under one link with expiring aliases (#38).
-- A link keeps its primary domain_id/slug in `links` (unchanged, still the
-- read path for every existing call site); `link_addresses` adds every
-- address a link answers to, including its own primary as a synced mirror
-- row. Slug uniqueness moves here so a temporary or expired alias can share
-- a (domain_id, slug) with a link's own current primary without colliding.

CREATE TABLE link_addresses (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  domain_id TEXT REFERENCES domains(id),
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('primary', 'temp_alias', 'permanent_alias')),
  -- '' for the original primary row created alongside its link; every later
  -- address remembers how it came to exist.
  creation_reason TEXT NOT NULL DEFAULT ''
    CHECK (creation_reason IN ('created', 'renamed', 'promoted', 'same_destination_merge', '')),
  -- NULL = never expires (primary, permanent_alias). Set only on temp_alias,
  -- to now + 48h at creation.
  expires_at INTEGER,
  -- NULL = active. Set once (by "Remove now" or the expiry sweep) and never
  -- cleared: the row stays for its historical clicks, just no longer live.
  retired_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_link_addresses_link ON link_addresses(link_id);
CREATE INDEX idx_link_addresses_org ON link_addresses(org_id);

-- One primary row per existing link, mirroring its current domain_id/slug.
INSERT INTO link_addresses (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at)
SELECT lower(hex(randomblob(16))), id, org_id, domain_id, slug, 'primary', '', NULL, NULL, created_at
FROM links;

-- Slug uniqueness now lives on the active address set, not on `links`
-- directly: a renamed-away slug keeps its row (as a temp_alias) instead of
-- disappearing, so two rows can share a (domain_id, slug) as long as only
-- one is active.
CREATE UNIQUE INDEX idx_link_addresses_domain_slug_active
  ON link_addresses(ifnull(domain_id, ''), slug) WHERE retired_at IS NULL;

DROP INDEX idx_links_domain_slug;

-- Nullable and not backfilled: existing clicks predate per-address
-- attribution and stay NULL, same reasoning as clicks.dedupe_id in 0013.
ALTER TABLE clicks ADD COLUMN address_id TEXT REFERENCES link_addresses(id) ON DELETE SET NULL;
CREATE INDEX idx_clicks_address_ts ON clicks(address_id, ts);
