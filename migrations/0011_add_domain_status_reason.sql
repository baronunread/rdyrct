-- Migration 0011: give a stuck or failed domain a human-readable reason.
-- The activation workflow writes this when it lands a domain in 'error' (DNS
-- never resolved, certificate never issued), so the UI and operators can see
-- why. Empty for every other status.
ALTER TABLE domains ADD COLUMN status_reason TEXT NOT NULL DEFAULT '';
