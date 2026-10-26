-- How a domain proves itself to Cloudflare (#383). 'http', the default, waits
-- for the CNAME and then issues the certificate. 'txt' checks two TXT records
-- instead, so a domain moving from another service is fully set up while it
-- still points there, and its CNAME can switch with no gap.
ALTER TABLE domains ADD COLUMN validation TEXT NOT NULL DEFAULT 'http';
