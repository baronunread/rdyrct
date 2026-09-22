-- Better Auth 1.7.5 keys an account by (provider_id, account_id), the same
-- pair 0028's issuer column briefly changed and 0032 reverted from. Nothing
-- enforced uniqueness on that pair at the database level: the account-linking
-- path checks for an existing row and then inserts, not inside a transaction
-- spanning both, so two concurrent callbacks for the same provider account
-- (a double-submitted OAuth redirect, two open tabs) could each pass the
-- check and insert a duplicate row, and a later lookup that expects exactly
-- one match would throw.
CREATE UNIQUE INDEX idx_account_provider_account_id
  ON account (provider_id, account_id);
