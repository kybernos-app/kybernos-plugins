---
name: webapp-build
description: "Construire ou modifier l'app d'un brief webapp.json : maquette lue d'abord, mini base SQLite, code, puis la passe UI en 5 points. Use when a webapp.json brief exists and the person wants the app built, changed or iterated."
---

# webapp-build — maquette d'abord, code ensuite, rien sans preuve

Entrée : `webapp.json` (skill `webapp-brief`). Sortie : l'app tourne en local, sa
mini base s'affiche dans l'onglet « Base de données », la passe UI est verte.

## Contraintes critiques (lues avant tout)

1. **La maquette AVANT le code** — fidélité déclarée (`statique` · `simple` ·
   `interactive`), chaque planche **ouverte et lue** avec `read_image` : une
   capture non regardée n'est pas une preuve. Texte coupé, contraste plat,
   hiérarchie molle → corrigé avant d'écrire l'app.
2. **Le design se délègue à la voie design** (`subagent_claude_code`, effort
   high) — jamais un modèle texte qui improvise du CSS. Le brief du sous-agent
   **interdit tout navigateur** et dit que la vérification visuelle revient à
   l'appelant (leçon du 2026-10 : sinon il installe Playwright et ne livre rien).
3. **Sombre, responsive (palier 480 px), états vides et erreurs** : obligatoires ;
   chaque état est capturé ET lu.
4. **Démo marqué** : fausse donnée = mention « démo » + emails `.test`, jamais de
   vraisemblable présenté comme réel.

## Le parcours en 5 temps

1. **Maquette** (skill `html-prototype`, ou la voie design pour le haut de gamme)
   des écrans du brief → planches lues → accord du demandeur.
2. **Mini base** : contrat `mini-app-pack` — `~/.dsh/kybers/<app>/donnees.sqlite` +
   manifeste `pack` + copie de `crm.cjs` (`~/.dsh/kybers/mini-crm/crm.cjs`) ;
   obligatoire : `node crm.cjs check && node crm.cjs apercu && node crm.cjs export`.
3. **Code** : un petit serveur Node + SQLite (la base du temps 2, rien d'autre) et
   les pages fidèles à la maquette. Dépendances épinglées et listées dans
   `webapp.json` ; jamais `eval`, jamais de code distant exécuté.
4. **En local** : l'app démarre et les gestes jouent — créer, lire, modifier —
   avec l'écriture **vérifiée dans la base**, pas seulement dans l'UI.
5. **La passe UI en 5 points** (la DoD, tout ou rien) : comportement (chaque geste
   joué en live, persistance après rechargement) · vision (chaque état capturé et
   lu) · thème sombre · homogénéité avec la maquette · cas limites (écran vide,
   double envoi, bouton retour). Un échec se corrige, puis on **rejoue** la passe.

## Modifications en chat

« Ajoute un champ téléphone » = MAJ du brief (1 champ) → geste ciblé sur la base
et le code → relecture des écrans touchés → passe UI complète. Le brief reste la
source de vérité ; l'historique des versions permet le retour arrière.
