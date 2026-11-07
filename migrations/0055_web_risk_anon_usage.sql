-- Web Risk lookups the anonymous shortener spends per caller per UTC day.
--
-- POST /api/shorten has no org to count against, so without this one
-- caller could spend the whole site-wide day (web_risk_usage) on fresh
-- URLs and leave every org's links unchecked until midnight. Each lookup
-- for an anonymous link takes one from its caller's row first
-- (destination-check.ts, spendAnonWebRiskLookup).
--
-- `client` is the keyed HMAC of the caller's address (rate-limit.ts,
-- publicClientKey), never the address. The daily cron deletes every row
-- older than today, so none outlives the day it counts.
CREATE TABLE web_risk_anon_usage (
  client TEXT NOT NULL,
  -- Days since the Unix epoch, UTC.
  day INTEGER NOT NULL,
  lookups INTEGER NOT NULL,
  PRIMARY KEY (client, day)
);
