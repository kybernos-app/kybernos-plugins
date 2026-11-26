-- 001-notes — the example resource of the template. Replace it with your own entities (the chat
-- and the webapp-build skill will reshape this folder); the runner applies each file once.
CREATE TABLE IF NOT EXISTS notes (
  id       INTEGER PRIMARY KEY,
  titre    TEXT NOT NULL,
  contenu  TEXT NOT NULL DEFAULT '',
  fait     INTEGER NOT NULL DEFAULT 0,
  cree_le  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_fait ON notes(fait);
