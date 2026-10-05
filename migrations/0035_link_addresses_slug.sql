-- The redirect path now reads D1 when KV has no answer yet (a link created
-- seconds ago, or a KV write that failed). The only slug index is on
-- (ifnull(domain_id, ''), slug), which that lookup's `domain_id IS NULL` /
-- hostname join cannot use, so every miss scanned every active address.
-- With this one a miss reads about one row. The queue consumer's lookup is
-- the same query and gets faster too.
CREATE INDEX idx_link_addresses_slug_active ON link_addresses(slug) WHERE retired_at IS NULL;
