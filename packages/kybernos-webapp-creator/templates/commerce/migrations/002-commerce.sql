-- 002-commerce — the commerce preset on top of the web template. Schema inspired by Medusa v2's
-- concepts (products, orders, order lines), reduced to what a small shop needs; the invariants
-- (stock never negative, an order line always priced) are enforced in routes/boutique.js and
-- proven by the conformance suite.
CREATE TABLE IF NOT EXISTS produits (
  id         INTEGER PRIMARY KEY,
  nom        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prix_cents INTEGER NOT NULL CHECK (prix_cents >= 0),
  stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  actif      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS commandes (
  id           INTEGER PRIMARY KEY,
  client_nom   TEXT NOT NULL,
  client_email TEXT NOT NULL,
  statut       TEXT NOT NULL DEFAULT 'recue' CHECK (statut IN ('recue','reservee','payee','expediee','livree','annulee','remboursee')),
  total_cents  INTEGER NOT NULL DEFAULT 0,
  cree_le      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commande_lignes (
  id          INTEGER PRIMARY KEY,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  produit_id  INTEGER NOT NULL REFERENCES produits(id),
  quantite    INTEGER NOT NULL CHECK (quantite > 0),
  prix_cents  INTEGER NOT NULL CHECK (prix_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_produits_actif ON produits(actif);
CREATE INDEX IF NOT EXISTS idx_lignes_commande ON commande_lignes(commande_id);
