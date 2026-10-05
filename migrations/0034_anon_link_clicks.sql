-- A total, and only a total, for anonymous links (#96 Direction A): the
-- landing page shows "3 clicks so far" so a visitor has a reason to come back
-- and keep the link. Country, referrer and device stay something signing up
-- buys; this column cannot hold them.
ALTER TABLE anon_links ADD COLUMN clicks INTEGER NOT NULL DEFAULT 0;
