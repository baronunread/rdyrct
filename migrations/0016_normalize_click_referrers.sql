-- Reduce stored referrers to a bare hostname (issue #20).
--
-- Ingestion stored the Referer header verbatim, so rows written before this
-- hold whole URLs: other people's paths and query strings, which can carry
-- search terms, session tokens, and account identifiers. None of that is
-- ours to keep, and it sits for the full 400-day click retention.
-- normalizeReferrer() in src/worker/util.ts stops new rows from looking
-- like this; these statements fix the ones already written.
--
-- 0016, not 0015: a branch in flight also claims 0015.
--
-- SQLite has no URL parser, so this peels one delimiter at a time. Order
-- matters: strip the scheme, then everything from the first fragment/query/
-- path delimiter onward, which leaves at most `user:pass@host:port`, then
-- the credentials, then the port. Each statement is a no-op on a value that
-- doesn't contain its delimiter, so already-normalized rows pass through
-- untouched and re-running is harmless.
--
-- Best effort by design: a value this cannot reduce to something
-- hostname-shaped is emptied rather than kept, matching normalizeReferrer,
-- which returns "" rather than guessing.

-- scheme: "https://host/..." -> "host/..."
UPDATE clicks SET referrer = substr(referrer, instr(referrer, '://') + 3)
  WHERE referrer <> '' AND instr(referrer, '://') > 0;

-- fragment, then query, then path
UPDATE clicks SET referrer = substr(referrer, 1, instr(referrer, '#') - 1)
  WHERE referrer <> '' AND instr(referrer, '#') > 0;
UPDATE clicks SET referrer = substr(referrer, 1, instr(referrer, '?') - 1)
  WHERE referrer <> '' AND instr(referrer, '?') > 0;
UPDATE clicks SET referrer = substr(referrer, 1, instr(referrer, '/') - 1)
  WHERE referrer <> '' AND instr(referrer, '/') > 0;

-- credentials: "user:pass@host" -> "host". Before the port strip, so the
-- colon inside the credentials is already gone by then.
UPDATE clicks SET referrer = substr(referrer, instr(referrer, '@') + 1)
  WHERE referrer <> '' AND instr(referrer, '@') > 0;

-- port
UPDATE clicks SET referrer = substr(referrer, 1, instr(referrer, ':') - 1)
  WHERE referrer <> '' AND instr(referrer, ':') > 0;

UPDATE clicks SET referrer = lower(referrer) WHERE referrer <> '';

-- Anything that is still not hostname-shaped (no dot, a space, or longer
-- than DNS allows) was never a site name we could report on.
UPDATE clicks SET referrer = ''
  WHERE referrer <> ''
    AND (instr(referrer, '.') = 0 OR instr(referrer, ' ') > 0 OR length(referrer) > 253);
