-- Marketing opt-in: two lists, each its own consent. Consent lives here,
-- never only at a provider. Every column is null for every existing account:
-- nobody is opted in to either list, and nobody has been asked.
--   news_opt_in_at        when the person opted in to product news (new
--                         features and tips), epoch ms. Null means not opted
--                         in, whether they said no, never answered, or
--                         unsubscribed later.
--   news_opt_in_source    where the current product news answer came from:
--                         'signup' (the sign-up form), 'prompt' (the one-time
--                         dialog) or 'settings'. An unsubscribe link clears
--                         news_opt_in_at and leaves this as it was.
--   offers_opt_in_at      the same for offers (deals on paid plans).
--   offers_opt_in_source  the same for offers.
--   marketing_asked_at    when the person first answered anywhere, about
--                         either list, including at sign-up and by dismissing
--                         the dialog. One question covers both lists, so one
--                         column. Null means the dialog still owes them it.
ALTER TABLE user ADD COLUMN news_opt_in_at INTEGER;
ALTER TABLE user ADD COLUMN news_opt_in_source TEXT CHECK (news_opt_in_source IN ('signup','prompt','settings'));
ALTER TABLE user ADD COLUMN offers_opt_in_at INTEGER;
ALTER TABLE user ADD COLUMN offers_opt_in_source TEXT CHECK (offers_opt_in_source IN ('signup','prompt','settings'));
ALTER TABLE user ADD COLUMN marketing_asked_at INTEGER;
