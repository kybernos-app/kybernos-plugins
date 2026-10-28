travail: creation
fidelite: simple
dossier: docs/handoff/journal-activite/maquette-v1
raison: une seule scène à juger avant câblage (Réglages ▸ Journal d’activité), avec le CSS réel du bundle ; l’interactif (chips, live SSE, recherche) se prouve dans le GUI après activation, pas sur une planche.
regions:
  - cartes du jour (appels, tokens, appels non demandés, retries)
  - barre de filtres (chips de familles, recherche, session, live, export)
  - tableau (heure, famille, quoi, session, tokens, détail)
  - colonne 390 px (Session et Détail retirées)
  - fil Réglages (fold Système ouvert)
sources:
  - packages/kybernos-log/client.js (CSS et libellés du bundle)
  - packages/kybernos-log/index.js (familles et champs servis par l’hôte)
  - docs/handoff/session-msg/maquette-v1 (gabarit de planche)
  - jetons DSH mesurés sur 127.0.0.1:3080 (2026-10-20) + bloc sombre du moteur
controle:
  - rendu relu à chaque passe (regard.md)
  - kblg.css identique au CSS du bundle (test-client.mjs à venir)
  - check-maquette indisponible dans ce checkout (MODULE_NOT_FOUND) — voir README
