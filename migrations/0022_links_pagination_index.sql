-- Keyset pagination for an organization's links (see src/worker/links-page.ts).
--
-- The list walks (org_id, created_at desc, id desc) and resumes from a cursor
-- rather than an offset, so the query seeks straight to the row it starts
-- after. Without a composite index that seek is a scan of the org's rows and
-- a sort, which is the cost the cursor exists to avoid: idx_links_org alone
-- narrows to the organization and then still sorts everything it found.
--
-- id is in the index because it is the tiebreaker every cursor comparison
-- falls through to, and an index that stops at created_at leaves that
-- comparison to a sort.
CREATE INDEX idx_links_org_created ON links (org_id, created_at DESC, id DESC);

-- The slug sort is offered by the same list and pages the same way.
CREATE INDEX idx_links_org_slug ON links (org_id, slug, id);
