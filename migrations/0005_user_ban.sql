-- Platform admin "ban": a banned account keeps its orgs/links but cannot sign
-- in. Banning also wipes the user's sessions (see admin routes), and session
-- creation is refused in better-auth.ts.
ALTER TABLE user ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
