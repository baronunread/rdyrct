-- Add Polar subscription cancellation tracking to the user table.
ALTER TABLE user ADD COLUMN polar_subscription_cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN polar_subscription_current_period_end INTEGER;
