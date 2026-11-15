-- Every slug ever handed out on the shared domain, so none is handed out
-- twice. A deleted link's slug stays in old posts, emails and printed QR
-- codes; giving it to somebody else would point all of those at whatever
-- they chose. The table only grows: nothing deletes from it, and it holds
-- no org, link or user, so it outlives all three.
--
-- Custom-domain slugs are not here: only the domain's owner can make them.
CREATE TABLE issued_slugs (
  slug TEXT PRIMARY KEY,
  issued_at INTEGER NOT NULL
) WITHOUT ROWID;

-- What the database still knows about. Slugs deleted before this migration
-- left no row behind and cannot be recovered.
INSERT OR IGNORE INTO issued_slugs (slug, issued_at)
  SELECT slug, created_at FROM link_addresses WHERE domain_id IS NULL;
INSERT OR IGNORE INTO issued_slugs (slug, issued_at)
  SELECT slug, created_at FROM anon_links;
-- A report keeps the slug after its link is deleted. It has no host, so a
-- custom-domain slug may land here too; that only removes one random slug
-- from the pool of 27.5 billion.
INSERT OR IGNORE INTO issued_slugs (slug, issued_at)
  SELECT slug, created_at FROM link_reports;
