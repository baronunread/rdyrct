-- The address of the Google account linked to a user, read from the id token
-- when it is linked or signs in again (better-auth.ts, googleEmailOf). The
-- Signing in group on Settings shows it beside Google. Accounts linked before
-- this column stay null until their next Google sign-in, and the row says
-- "Connected" until then. Null for a password account.
ALTER TABLE account ADD COLUMN email TEXT;
