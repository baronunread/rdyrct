-- Reverts 0028. Better Auth 1.7.0-1.7.2 keyed provider accounts by issuer
-- plus account id; 1.7.3 reverted to 1.6's providerId+accountId identity and
-- stopped writing issuer at all ("the account schema is unchanged from
-- 1.6."). Bumping past 1.7.2 (for the MCP OAuth plugin, #139 follow-up) turned
-- that into a live bug: issuer stayed NOT NULL while nothing wrote it, so
-- every new account insert would fail.
DROP INDEX idx_account_issuer_account_id;
ALTER TABLE account DROP COLUMN issuer;
