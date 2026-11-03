-- The plan the admin audit log last recorded for each account.
--
-- reconcileUser (src/worker/reconcile.ts) compares it with `plan` and, when
-- they differ, writes a `plan.change` entry (from, to) and moves it on. That
-- is how Polar's upgrades, downgrades and cancellations reach the Audit page:
-- nothing else stores what a plan was before a webhook changed it. A comp
-- moves it in the same statement that changes `plan` (writeComp in
-- routes/admin.ts), since the comp entry already records that change.
--
-- Every account starts on free, so the default is right for a new row, and
-- existing rows start level with their plan: no history is invented for them.
ALTER TABLE user ADD COLUMN audited_plan TEXT NOT NULL DEFAULT 'free';
UPDATE user SET audited_plan = plan;
