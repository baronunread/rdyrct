-- Org-level default for how much of the QR code the embedded logo covers
-- (qr-code-styling imageSize ratio). NULL = built-in default (0.35).
ALTER TABLE orgs ADD COLUMN qr_logo_size REAL;
