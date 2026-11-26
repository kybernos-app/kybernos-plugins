-- 003-transactions — the transactional core: reserved stock, and payment events applied at most
-- once. An order in 'reservee' holds produits.reserve until payment, expiry or cancellation;
-- webhooks keeps every event id, so a replayed event has no second effect.
ALTER TABLE produits ADD COLUMN reserve INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS webhooks (
  event_id TEXT PRIMARY KEY,
  type     TEXT NOT NULL,
  effet    TEXT NOT NULL DEFAULT 'ignore',
  recu_le  TEXT NOT NULL DEFAULT (datetime('now'))
);
