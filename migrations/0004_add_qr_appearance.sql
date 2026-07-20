-- More QR appearance controls: corner ('eye') shape, background color, and a
-- separate accent color for the corner eyes. Empty string = inherit/built-in
-- default, matching the existing qr_style/qr_color convention.
ALTER TABLE orgs ADD COLUMN qr_corner TEXT NOT NULL DEFAULT '';
ALTER TABLE orgs ADD COLUMN qr_bg TEXT NOT NULL DEFAULT '';
ALTER TABLE orgs ADD COLUMN qr_eye_color TEXT NOT NULL DEFAULT '';

ALTER TABLE links ADD COLUMN qr_corner TEXT NOT NULL DEFAULT '';
ALTER TABLE links ADD COLUMN qr_bg TEXT NOT NULL DEFAULT '';
ALTER TABLE links ADD COLUMN qr_eye_color TEXT NOT NULL DEFAULT '';
