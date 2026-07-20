-- Per-link QR logo size override; NULL = inherit org default.
ALTER TABLE links ADD COLUMN qr_logo_size REAL;
