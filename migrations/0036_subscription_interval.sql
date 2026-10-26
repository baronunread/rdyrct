-- Which billing cycle the user's subscription is on ('month' or 'year'), read
-- off the Polar product id when a subscription event lands. The billing page
-- says it; nothing else reads it. NULL means no subscription (or one that
-- predates this column, until its next event).
ALTER TABLE user ADD COLUMN polar_subscription_interval TEXT;
