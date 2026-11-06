-- Newsletter sends: one row per issue (tests are not kept), keyed by the
-- composer's send id, which is also the id of the Cloudflare Workflow that
-- sends it (NewsletterSendWorkflow, src/worker/workflows.ts).
--   list           who it goes to: 'news' (product news) or 'offers'. Only
--                  people opted in to that list get it.
--   audience       narrows that list further, as JSON
--                  ({"stage":"new","plan":"free"}, see AudienceFilter in
--                  src/shared/types.ts). Every batch reads it from here.
--   subject, doc   the issue: its subject and the editor's JSON document.
--                  Kept so a scheduled send renders when it goes, and every
--                  batch renders the same issue.
--   created_at     when the admin pressed Send now or Schedule, epoch ms.
--   scheduled_for  when it goes, epoch ms; null for Send now.
--   status         scheduled (waiting for scheduled_for), sending, sent,
--                  cancelled (by an admin, before it went) or failed (a
--                  batch failed every retry; sent says how many went).
--   sent, cursor   after each batch of people (ordered by id) the row
--                  records how many went and the last id reached, so a
--                  retried batch carries on from there and nobody gets it
--                  twice.
--   finished_at    when it ended: sent, cancelled or failed.
--   sent_by        the admin's user id, nulled if that account is deleted.
CREATE TABLE newsletter_sends (
  id TEXT PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('news','offers')),
  audience TEXT NOT NULL DEFAULT '{"stage":"any","plan":"any"}' CHECK (json_valid(audience)),
  subject TEXT NOT NULL,
  doc TEXT NOT NULL CHECK (json_valid(doc)),
  sent_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  scheduled_for INTEGER,
  status TEXT NOT NULL CHECK (status IN ('scheduled','sending','sent','cancelled','failed')),
  sent INTEGER NOT NULL DEFAULT 0,
  cursor TEXT NOT NULL DEFAULT '',
  finished_at INTEGER
);
CREATE INDEX idx_newsletter_sends_created_at ON newsletter_sends (created_at);
