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
--
-- The closing filters mirror isReportableHost() in src/worker/util.ts, so a
-- row that survives this is a row ingestion would accept today. Change one
-- and change the other, or the table keeps referrers the live path refuses.

-- A referrer arrives over http(s). Anything else (data:, javascript:, ftp:,
-- an app's custom scheme) is not a site we can name, and normalizeReferrer
-- refuses it. Clear those first: after the scheme strip below,
-- "ftp://collector.example" is indistinguishable from a real hostname.
UPDATE clicks SET referrer = ''
  WHERE referrer <> ''
    AND instr(referrer, '://') > 0
    AND lower(referrer) NOT LIKE 'http://%'
    AND lower(referrer) NOT LIKE 'https://%';

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

-- Anything still not hostname-shaped was never a site name we could report
-- on: too long for DNS, no dot (a bare word like "localhost"), an empty
-- label from a leading, trailing, or doubled dot, or a character a hostname
-- cannot hold. The GLOB carries the character rule, and rejects control
-- characters, spaces, and stray punctuation in one pass; it runs after the
-- lower() above, so an uppercase letter here really is a leftover.
UPDATE clicks SET referrer = ''
  WHERE referrer <> ''
    AND (length(referrer) > 253
      OR instr(referrer, '.') = 0
      OR instr(referrer, '..') > 0
      OR referrer LIKE '.%'
      OR referrer LIKE '%.'
      OR referrer GLOB '*[^a-z0-9.-]*');

-- The one rule the filters above cannot express: no single label may run
-- past 63 characters. GLOB cannot say "64 characters that are not a dot"
-- (SQLite rejects that pattern as too complex), so peel the labels off one
-- at a time and measure them. The trailing '.' the seed row appends gives
-- the last label a delimiter to be found by, so it is measured like the
-- rest.
WITH RECURSIVE labels(id, rest, label) AS (
  SELECT id, referrer || '.', '' FROM clicks WHERE referrer <> ''
  UNION ALL
  SELECT id, substr(rest, instr(rest, '.') + 1), substr(rest, 1, instr(rest, '.') - 1)
    FROM labels WHERE instr(rest, '.') > 0
)
UPDATE clicks SET referrer = ''
  WHERE id IN (SELECT id FROM labels WHERE length(label) > 63);
