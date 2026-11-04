-- Marketing opt-in (newsletter). Consent lives here, never only at a provider.
-- All three are null for every existing account: nobody is opted in, and
-- nobody has been asked.
--   marketing_opt_in_at     when the person opted in (epoch ms). Null means not
--                           opted in, whether they said no, never answered, or
--                           unsubscribed later.
--   marketing_opt_in_source where the current answer came from: 'signup' (the
--                           sign-up form), 'prompt' (the one-time dialog) or
--                           'settings'. An unsubscribe link clears
--                           marketing_opt_in_at and leaves this as it was.
--   marketing_asked_at      when the person first answered anywhere, including
--                           at sign-up and by dismissing the dialog. Null means
--                           the dialog still owes them the question.
ALTER TABLE user ADD COLUMN marketing_opt_in_at INTEGER;
ALTER TABLE user ADD COLUMN marketing_opt_in_source TEXT CHECK (marketing_opt_in_source IN ('signup','prompt','settings'));
ALTER TABLE user ADD COLUMN marketing_asked_at INTEGER;
