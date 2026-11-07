-- Who filed a report, as far as telling two reporters apart needs. A free
-- org's link gets the warning page only once enough different reporters have
-- open reports on it (routes/reports.ts), so one stranger cannot put it there
-- alone. The value is a keyed HMAC of the reporter's connection and the link
-- id: never the IP address, and the same reporter gets a different value on
-- every link, so it cannot follow anybody across reports. Null for reports
-- made before this column existed, and for reports that matched no link.
ALTER TABLE link_reports ADD COLUMN reporter_key TEXT;
-- The daily sweep that lifts week-old report warnings reads warned links only.
CREATE INDEX idx_links_warned ON links(warned_at) WHERE warned_at IS NOT NULL;
