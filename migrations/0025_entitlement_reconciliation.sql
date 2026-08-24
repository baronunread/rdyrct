-- Migration 0025: what a downgrade did to an org, written down (#158).
--
-- One row per org that has ever been reconciled. `over_json` is what was over
-- cap when the pass last ran, `grace_ends_at` is when the 30 days run out for
-- the resources that keep working through it (custom domains, #159). Both are
-- cleared when the org is back inside its plan, so a row with a null
-- `grace_ends_at` and an empty `over_json` means "fine", not "never checked".
--
-- The marker columns live on the resources themselves rather than in here:
-- one lookup, in the place every reader already has in hand.

CREATE TABLE org_entitlements (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  -- The owner's plan the last pass compared against.
  plan TEXT NOT NULL,
  -- {"links":500,"members":25,"domains":5} — only the resources over cap.
  over_json TEXT NOT NULL DEFAULT '{}',
  -- Epoch ms the grace period ends; null while nothing is over.
  grace_ends_at INTEGER,
  reconciled_at INTEGER NOT NULL,
  -- Epoch ms the day-0 and day-23 emails went out, for the grace period
  -- `grace_ends_at` describes. Cleared with it.
  notified_at INTEGER,
  warned_at INTEGER
);

-- The daily cron reads this to find graces about to run out.
CREATE INDEX idx_org_entitlements_grace ON org_entitlements(grace_ends_at);

-- Which org the owner keeps active when they own more than their plan allows
-- (#160). Null means active. A locked org is read-only and still counts
-- against the cap.
ALTER TABLE orgs ADD COLUMN locked_at INTEGER;

-- A domain beyond the plan's `domains` cap (#159). Still serving until the
-- org's grace ends, then not; never deleted.
ALTER TABLE domains ADD COLUMN locked_at INTEGER;

-- What this member was before a downgrade demoted them to viewer (#161), so
-- re-upgrading puts them back. Null means they were never demoted.
ALTER TABLE org_members ADD COLUMN previous_role TEXT;
