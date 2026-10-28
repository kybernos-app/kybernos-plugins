# Livraison — Phase A « sector themes » (gate humain)

Campagne `dev-team` du 2026-10-28, ~23h (15h59 → 10h00). **Aucun merge n'a été
fait : ce dossier est la livraison, et le merge attend la validation humaine**
(l'étage `livraison` du pipeline est un gate — la doctrine « push = validation
explicite »).

## 1. L'objectif, point par point

| # | Objectif | État | Preuve |
|---|---|---|---|
| 1 | Couture publique « apply a preset », branchée sur l'étape Kit | ✅ **fait** | `applyPreset` + `THEME_POINT` + `__KB_THEME_APPLY__` (3efbdfdb), branchement Kit (9c3dfe3d) ; DoD 6/6 ; `test-onboarding.mjs` all checks passed |
| 2 | Plugins data multi-points (themes/, skills/, teams/, automations/ comme domains/) | ✅ **fait** | A2-pack-format + A2-registry-points (3efbdfdb) ; `test-domain-pack` 52 checks ; `test-registry` 85 ✓ |
| 3 | Les deux thèmes médecin + recrutement, bout en bout | ✅ **fait** | packs + presets de style + kit (3efbdfdb, a11942f1) ; 6 thèmes au catalogue avec 4 de plus |
| 4 | Template de départ + page « Build a theme » | ✅ **fait** | `docs/dev/sector-bundles.md` + `docs/dev/templates/acme-vet-clinic/` (24 fichiers) + `scripts/plugin-check.mjs` (fcbf14c1) |
| — | Pipeline complet (specs → GO gate → impl → tests → revue adversariale) | ✅ **joué** | 15 specs, 3 passes de porte, 10 lots implémentés, 1 campagne de tests, **3 grilles adversariales** |
| — | Validation humaine avant merge | ⏳ **ce dossier** | — |

## 2. Ce que la campagne a livré (14 commits sur `feature/vertical-bundles-phase-a`)

- **Le contrat** : `contrat-pack-vertical` (skill), `docs/dev/sector-bundles.md`,
  `plugin-contract.md` + `domain-packs.md` alignés, `plugin-check.mjs` (13 contrôles).
- **Le moteur de thèmes** : la couture apply-preset (seul écrivain de la
  bibliothèque disque depuis un import), le point `kybernos/theme#theme`, le format
  multi-points, les scans du registre, l'installateur (un clic = consentement, kit à
  cocher, automatisations éteintes), la marketplace (listage par secteur, sources en
  Réglages, catalogue signé **câblé** : octets récupérés, `verifyArchive` en
  production, « official » dérivé des signatures).
- **6 thèmes** : cabinet médical, recrutement SSII, location immobilière, e-commerce,
  cabinet d'avocats, éducation — packs cités, accents cités, marqués PROPOSAL.
- **L'outil de conformité** + le starter (8 fichiers) + 7 variantes cassées.

## 3. L'état mesuré (jamais déclaré)

- `node scripts/run-all-tests.mjs` → **532 fichiers · 528 verts · 4 ROUGES** :
  `test-help` (trou de doc pré-existant), `test-no-legacy-hosts`, `test-plugin-scan`,
  `test-host` (le trio cloud — le renommage cloud du voisin, ticketé). **Aucun
  introduit par la campagne** ; le baseline D8 en comptait 12, la campagne en a
  effacé 8 (dont 2 en corrigeant ses propres rouges).
- Suites de campagne : theme 450 ✓ · preset-store 74 ✓ · themes-catalogue 72+30 ✓ ·
  domain-pack 52 ✓ · onboarding 213 ok ✓ · plugin-check 52 ✓ · registry 85 ✓ ·
  theme-installer 44 ✓ · theme-market 82 ✓ · log 28+12 ✓.
- Conformité : starter 13 pass / 0 fail ; variante cassée refusée avec le bon id.
- Parcours live : rouges attribuables à la campagne **6 → 0** (le pré-existant reste,
  ticketé).

## 4. Ce que la revue adversariale a chassé (3 grilles)

BLOCK → BLOCK (rétréci) → **WARN (aucun ancrage BLOCK)**. Les catches qui comptent :
la perte de données du chemin d'import (un enregistrement « me » écrasable, un
collisionné innocent dépouillé), le flux catalogue décoratif (confiance auto-déclarée,
zéro appelant de production), les fixtures qui prouvaient des fixtures, et un
truquage de garde (plafond relevé au lieu d'une ligne CSS — défait).

## 5. Tickets ouverts (WARN de la grille finale, pas bloquants)

- N2 consigné : le message de `4b6f13a4` disait « 3 rouges » — la mesure dit 4
  (corrigé en toutes lettres dans `c6708a8c`).
- W2 : la règle cible-de-clic du check live accepte une paire empilée (24 px) ;
  F-38 : un falsifier non commité ; F-5 : cinq jeux d'assertions jamais « dé-robustifiés » ;
  F-31 : `revokedKeys` encore décoratif ; F-2 partiel ; la brèche UI « l'écran Kit
  défile » ; les 3 consommateurs cloud périmés.

## 6. Le gate humain — ce qu'on demande

1. **Valider** (ou refuser) la livraison telle quelle.
2. Sur validation : merge dans `dev` (la règle dépôt : `node scripts/run-all-tests.mjs`
   à 0 rouge **avant** merge — les 4 rouges sont nommées ci-dessus et doivent être
   soit corrigées, soit explicitement acceptées dans le message de merge, comme
   l'AGENTS.md l'y autorise pour le pré-existant ticketé).
3. Les WARN de la section 5 partent en tickets le jour même (règle dépôt).
