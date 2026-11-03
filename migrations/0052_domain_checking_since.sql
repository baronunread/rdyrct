-- When the current check of a domain started. Null means at creation
-- (created_at). "Try again" on a domain whose check failed sets it, so the
-- deadline (a day, or a week for TXT validation) counts from the retry
-- instead of making somebody delete a domain their links still use.
ALTER TABLE domains ADD COLUMN checking_since INTEGER;
