-- An org-level default domain for new links (#69).
--
-- An org that has bought and verified a custom domain had to re-pick it on
-- every link it created, because the editor starts every form at the shared
-- domain. This records the org's own answer once.
--
-- Org-level, not per-user: it describes how the organization publishes its
-- links, not a preference of whoever happens to be signed in. Same shape as
-- the org QR defaults already on this table.
--
-- ON DELETE SET NULL rather than a cascade: deleting a domain must not delete
-- the organization. The column simply forgets, and new links go back to the
-- shared domain.
--
-- Null on existing rows, which is exactly the behaviour they have today.
--
-- The reference points at a table that already references `orgs`, which SQLite
-- allows: the cycle is between rows, and neither side is required.

ALTER TABLE orgs ADD COLUMN default_domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL;
