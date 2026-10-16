-- When the welcome email went out, so it goes out once. Everyone already
-- verified is marked as welcomed: a welcome weeks after sign-up, triggered by
-- the next profile edit, would be worse than none.
ALTER TABLE user ADD COLUMN welcome_sent_at INTEGER;
UPDATE user SET welcome_sent_at = unixepoch() * 1000 WHERE email_verified = 1;
