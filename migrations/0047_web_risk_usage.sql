-- Calls to Google Web Risk, counted per UTC day across the whole site.
--
-- Google lists no per-day quota for the Lookup API, only one per minute, and
-- the free tier is 100,000 calls a month. Every call takes one from today's
-- row first (risk.ts, takeWebRiskLookup) and is not made once the day's cap
-- is spent. One row a day, kept: the admin Usage page sums the month from it.
CREATE TABLE web_risk_usage (
  -- Days since the Unix epoch, UTC.
  day INTEGER PRIMARY KEY,
  lookups INTEGER NOT NULL
);
