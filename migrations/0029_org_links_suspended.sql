-- The abuse sweep (#224) suspended individual links but left the organization
-- itself writable, so it could mint new links right up to the next pass.
-- Mirrors orgs.locked_at: null means not suspended.
ALTER TABLE orgs ADD COLUMN links_suspended_at INTEGER;
