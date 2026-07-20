-- Add the 'hobby' plan by parking the old column and re-adding `plan` with a
-- wider CHECK.
--
-- Why not rebuild the table: D1 runs migration statements without a persistent
-- session, so `PRAGMA foreign_keys = off` doesn't survive to a later DROP
-- TABLE, whose implicit DELETE would cascade-wipe session/account/org_members
-- (verified locally). This route never drops anything, so FKs are untouched.
--
-- `plan_legacy` stays behind for good: SQLite refuses to DROP a column that is
-- referenced by its own CHECK constraint. New rows fill it with its default
-- ('free'), which always satisfies the old CHECK; nothing reads it again.
ALTER TABLE user RENAME COLUMN plan TO plan_legacy;
ALTER TABLE user ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'hobby', 'pro'));
UPDATE user SET plan = plan_legacy;
