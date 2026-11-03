-- When the account last made a signed-in request, kept to the hour
-- (session.ts, markSeen). The members list's "Last active" reads it beside
-- the sessions: those are deleted on sign-out, so on their own they said
-- "Never" for anybody who had signed out everywhere.
ALTER TABLE user ADD COLUMN last_seen_at INTEGER;
