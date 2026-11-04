-- Newsletter send history: one row per issue that went out (tests are not
-- kept). The id is the composer's send id, so a retried send of the same
-- issue updates its row instead of adding a second one. sent_by is the
-- admin's user id, nulled if that account is deleted.
CREATE TABLE newsletter_sends (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  sent_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  sent_at INTEGER NOT NULL,
  sent INTEGER NOT NULL
);
CREATE INDEX idx_newsletter_sends_sent_at ON newsletter_sends (sent_at);
