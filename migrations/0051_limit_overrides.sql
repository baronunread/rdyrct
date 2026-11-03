-- Custom limits for one account, set by a platform admin (the Enterprise
-- arrangement). One row per limit that differs from the plan; no rows means
-- the plan's own limits. The effective value of each key is the higher of the
-- plan's and this, and only while the account is on a paid plan: see
-- effectiveLimits in src/shared/limits.ts. `limit_key` is PlanLimits' keys in
-- snake_case; `qr_custom` is 0 or 1.
CREATE TABLE limit_overrides (
  user_id   TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  limit_key TEXT NOT NULL CHECK (limit_key IN ('orgs','links','members','domains','qr_custom','analytics_days','tracked_clicks')),
  value     INTEGER NOT NULL,
  note      TEXT,
  set_by    TEXT,
  set_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, limit_key)
);

-- Pro stopped including extra organizations. Whoever already owns more than
-- one keeps them: their `orgs` limit is the number they have now. Locked orgs
-- (read-only after a downgrade) and orgs being deleted do not count, so a
-- downgraded account does not get its locked orgs back for free. On a fresh
-- database there are no owners, so this adds nothing.
INSERT INTO limit_overrides (user_id, limit_key, value, note, set_at)
SELECT m.user_id, 'orgs', count(*),
       'Grandfathered: owned ' || count(*) || ' organizations before Pro covered one',
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM org_members m JOIN orgs o ON o.id = m.org_id
WHERE m.role = 'owner' AND o.locked_at IS NULL AND o.deleting_at IS NULL
GROUP BY m.user_id
HAVING count(*) > 1;
