-- Reports about anonymous links (#488). A report about a landing-page link
-- used to match nothing, because the lookup only read link_addresses.
--
-- anon_link_id has no foreign key on purpose: the daily sweep deletes an
-- anonymous link 24 hours after it was made, and the report should still say
-- what it was about after that.
ALTER TABLE link_reports ADD COLUMN anon_link_id TEXT;
CREATE INDEX idx_link_reports_anon ON link_reports(anon_link_id) WHERE anon_link_id IS NOT NULL;
