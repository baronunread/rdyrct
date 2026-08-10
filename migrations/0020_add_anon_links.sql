-- The anonymous shortener on the landing page (Direction A of #96).
--
-- Somebody who lands on the page can shorten a link without an account, and
-- keep it by signing up. That closes the activation cliff in #65 from the
-- other side: the new account already has a link in it before it is even
-- created, so the first thing a signed-in person sees is their own work
-- rather than an empty dashboard.
--
-- Its own table, not a row in `links` with a null org:
--   - `links.org_id` is NOT NULL and every link carries a plan quota, an
--     owner and analytics. An anonymous link has none of those, and teaching
--     all of that code to expect nulls would be a much wider change than a
--     table with five columns.
--   - Anonymous links expire in 24 hours. Sweeping a separate table cannot
--     touch anybody's real links, which is worth a lot in a delete job.
--   - Claiming moves it into `links` properly, so nothing downstream ever
--     sees a half-owned row.
--
-- claim_token is the bearer proof of "I am the browser that made this". It is
-- random and single-use: claiming clears the row. Whoever holds it can claim
-- the link, which is the intended behaviour, since the only thing at stake is
-- a 24-hour link the holder created.
--
-- No foreign keys anywhere. This table deliberately does not reference orgs
-- or users, because at the moment a row is written neither exists.

CREATE TABLE anon_links (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  destination TEXT NOT NULL,
  claim_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Risk columns mirror `links` (#68): an unauthenticated write path is the
  -- one that most needs its destinations looked at.
  risk_score INTEGER,
  risk_reasons TEXT,
  risk_checked_at INTEGER,
  risk_provider TEXT
);

-- The sweep orders by this, and the claim looks up by token (already unique,
-- so already indexed).
CREATE INDEX idx_anon_links_expires ON anon_links (expires_at);
