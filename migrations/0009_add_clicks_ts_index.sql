-- Add standalone index on clicks(ts) to optimize retention cleanup query
-- The cleanup query filters on ts: delete from clicks where id in (select id from clicks where ts < ? limit 1000)

CREATE INDEX idx_clicks_ts ON clicks(ts);