-- Newsletter sends: one row per issue (tests are not kept), keyed by the
-- composer's send id. list is who it went to: 'news' (product news) or
-- 'offers', and only people opted in to that list get it. audience narrows
-- that list further, as JSON ({"stage":"new","plan":"free"}, see
-- AudienceFilter in src/shared/types.ts); a resumed send reads it from here,
-- so it carries on to the same people. A send goes out in
-- batches of people ordered by id; after each batch the row records how many
-- went and the last id reached (cursor), so a send that stopped (a provider
-- error, or the per-request batch limit) carries on from there when the admin
-- sends again. done is 1 once nobody is left. sent_by is the admin's user id,
-- nulled if that account is deleted.
CREATE TABLE newsletter_sends (
  id TEXT PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('news','offers')),
  audience TEXT NOT NULL DEFAULT '{"stage":"any","plan":"any"}' CHECK (json_valid(audience)),
  subject TEXT NOT NULL,
  sent_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  sent_at INTEGER NOT NULL,
  sent INTEGER NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_newsletter_sends_sent_at ON newsletter_sends (sent_at);
