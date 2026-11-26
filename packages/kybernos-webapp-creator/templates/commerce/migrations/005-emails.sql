-- 005-emails — transactional emails, recorded once per payment event. The replayed webhook sends
-- no second email because the event is already recorded (the idempotency of 003).
CREATE TABLE IF NOT EXISTS emails (
  id           INTEGER PRIMARY KEY,
  commande_id  INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  sujet        TEXT NOT NULL,
  destinataire TEXT NOT NULL,
  envoye_le    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_commande ON emails(commande_id);
