-- Imports from another service (#383) run on the server, so closing the tab
-- does not stop one. The browser uploads the file's rows here, then a
-- workflow writes them in chunks and records what happened to each row.
CREATE TABLE link_imports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  -- shortio, bitly, rebrandly, dub or csv: which instructions it came with.
  service TEXT NOT NULL,
  -- uploading: rows still arriving. running: the workflow is writing them.
  -- done: every row has an outcome. dismissed: the person started another.
  status TEXT NOT NULL DEFAULT 'uploading',
  total INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_link_imports_org ON link_imports(org_id, created_at);

CREATE TABLE link_import_rows (
  import_id TEXT NOT NULL REFERENCES link_imports(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  host TEXT NOT NULL,
  slug TEXT NOT NULL,
  destination TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  -- pending until the workflow reaches it, then imported, exists or failed.
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (import_id, line)
);
CREATE INDEX idx_link_import_rows_status ON link_import_rows(import_id, status);
