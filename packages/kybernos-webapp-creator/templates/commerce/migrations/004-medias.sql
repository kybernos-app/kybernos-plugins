-- 004-medias — the media chain: uploaded files are rows here and bytes in the media/ folder,
-- OUTSIDE the public root. Nothing is served from disk paths the client chooses.
CREATE TABLE IF NOT EXISTS medias (
  id       INTEGER PRIMARY KEY,
  mime     TEXT NOT NULL,
  taille   INTEGER NOT NULL,
  chemin   TEXT NOT NULL,
  cree_le  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE produits ADD COLUMN image_id INTEGER REFERENCES medias(id);
