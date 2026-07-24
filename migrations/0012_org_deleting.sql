-- Migration 0012: mark an org as tearing down before the teardown workflow
-- gathers its KV keys and Cloudflare hostnames, so a write racing the delete
-- request cannot create a link or domain the workflow never sees. NULL means
-- not deleting; any other value is the timestamp deletion started.
ALTER TABLE orgs ADD COLUMN deleting_at INTEGER;
