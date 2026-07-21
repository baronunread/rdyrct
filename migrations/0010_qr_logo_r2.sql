-- QR logos moved out of D1 into R2 (bucket rdyrct-qr-logos): qr_logo now
-- holds only the /qr-logo/<key> URL. The old inline base64 blobs are dropped,
-- not migrated.
UPDATE orgs SET qr_logo = '' WHERE qr_logo != '';
UPDATE links SET qr_logo = '' WHERE qr_logo != '';
