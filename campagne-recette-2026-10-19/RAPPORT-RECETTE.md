# Rapport de recette — DSH local + plugins Kybernos

- **Campagne** : recette pré-prod focus DSH local + plugins (hors serveur kybernos, hors compte, hors billing)
- **Périmètre** : GUI `127.0.0.1:3080` — accueil/chat, barre latérale, volet droit (Summary, Databases, Bricks, Slides, 3D modeller, Motion, Dashboard, Kaby, Agent Teams), panneaux Kybernos (Dashboards, Agent Teams, Workspaces, Creations, Automations, Skills, Connectors), menu compte (Team settings, Account, Referral, Appearance, Settings), Settings ×9 sections, thème clair/sombre, i18n, configuration (toggles + persistance), scripts live du repo
- **Tier** : app locale réelle `http://127.0.0.1:3080` (cookie signé 30 j) + instance sandbox isolée `:3099` pour les scripts à écriture
- **Preuves** : `campagne-recette-2026-10-19/` — 34 captures `captures/`, inventaires `vague0-matrice.md`, `vague0-panneaux.json`, audit i18n `i18n-fr.json`
- **Constats non tranchés** : section dédiée en fin de rapport
- **Méthode** : chasse en vagues lecture seule (skill `chasse-bugs-ui`), batteries `scripts/check-*-live.mjs` du repo, vérifications manuelles avec preuve disque/DOM/capture. Aucune correction appliquée.

## 1. Synthèse

**421 checks automatisés verts + 12 parcours manuels prouvés.** Aucun P0. Aucun P1. Six défauts produits confirmés (P2 ×3, WARN ×3), tous cosmétiques ou de contenu. **Verdict : GO pour la mise en production** de la partie DSH locale + plugins, sous réserve de la passe vision (bloquée ce soir, voir §5) et du traitement recommandé des P2.

## 2. Constats par sévérité

| # | Sev | Constat | Preuve / ancrage |
|---|-----|---------|------------------|
| 1 | P2 | i18n : 1494 chaînes anglaises restantes en UI française (531 uniques) — toute la barre latérale et la nav (Kaby, Dashboards, Agent Teams, Workspaces, Creations, Automations, Skills, Connectors) restent en anglais | audit `i18n-fr.json` (17 pages), couloir i18n |
| 2 | P2 | Erreur console à chaque chargement : 409 Conflict sur `/kybernos-hub/catalogue/refresh` | console navigateur de test, rounds 3-10 (répété) |
| 3 | P2 | Page Language : libellés de bouton incohérents — « Use now » à 91 % traduit (ar/es/it) mais « Use anyway » à 95 % (polonais) ; seuil ou libellé à homogénéiser | capture `captures/v1-language-page.png` |
| 4 | WARN | Dashboard dupliqué : « Usage and tokens » et « Usage and tokens 2 », descriptions identiques | panneau Dashboards, `vague0-panneaux.json` |
| 5 | WARN | Preset « Workspace pulse » : description différente entre Mes dashboards (« Sessions, deliverables… ») et Presets (« Sessions, creations… ») | panneau Dashboards (idem) |
| 6 | WARN | Icônes de menu rendues à 17,5 px au lieu des 16 px attendus par `check-menu-icons-live` (dessin et styles sinon parfaits : 21 sets, 8/8 rangées) | mesure DOM directe (dpr 2), check-menu-icons-live 20 ✗ |

## 3. Parcours prouvés verts (preuves faites)

| Parcours | Preuve |
|---|---|
| Toggle Settings « Name each chat when it ends » → écriture disque immédiate (`settings.json`) | `cat` du fichier avant/après, restauré |
| Workspace : création (dialogue, Create gardé sans nom) → dossier `~/Documents/Kybernos/qa-recette-temp` créé → suppression avec confirmation → disparu de la liste | DOM + preuve disque + nettoyage |
| Thème : bascule Light/Dark, persistance après reload (`kybernos.theme.v1`) | localStorage lu après reload |
| Édition d'automation « Edit in chat » : brouillon complet (skill, id, cron+zone, approbations) | capture `v1-automation-edit-draft.png` + lecture composer |
| Panneau Slides + deck démo : 5/5 slides, outils Text/Brush/Eraser | captures `v1-panel-slides.png`, `v1-slides-demo.png` |
| 3D modeller + démo Lighthouse : canvas actif | capture `v1-3d-demo.png` |
| Motion : panneau, état vide, liste « My animations » | capture `v1-motion-list.png` |
| Kaby : channels, Computer (This machine / Home cloud), Ready | DOM + capture `v1-kaby.png` |
| Page Language : FR/EN/ar RTL/es/it/pl, reprise de traduction, dossier disque | capture `v1-language-page.png` |
| Brouillon d'édition survit au rechargement de page | composer relu après reload |
| Batteries check-*-live : 349 verts (cardface 59, help-intro 63, automations-board-partiel 72, skills-detail 21, newchat 23, settings-nav 16, menu-density 17, connections 48, icons 14, account-menu 11, miniapps 15, study-model 19, connectors 7, animations 7, cloud-menu 5, free-llms 12, creations-search 12…) | sorties des scripts, rounds 4-9 |

## 4. Écartés (pas le produit)

- **check-language-live 12 ✗** : faux négatifs environnementaux — page Language prouvée OK à la main ; le script crashe (JSON.parse) faute d'ouvrir la page dans son Chrome jetable.
- **check-automations-list/board en sandbox (24 ✗)** : sandbox dégradé (setup FAIL : lien du module payant `kybernos-servers` absent du worktree → gateway `sessionController unavailable`) ; parcours prouvé vert sur :3080.
- **check-slides/motion/modeleur en sandbox (61 ✗)** : même cause ; panneaux prouvés vivants sur :3080 (captures).
- **check-connectors-matrix : github spec_too_large / open-meteo 404** : défaut de données externes, pas la GUI.
- **« Thème dérivant »** : le thème se synchronise par disque (~/.dsh) entre navigateurs — mes scripts de test (HOME réel) le basculaient. Comportement produit cohérent pour un utilisateur seul.
- **Nav « Plugins » fantôme** (vu au 1er inventaire CDP, introuvable ensuite) : artefact du premier sélecteur DOM ; le bouton « Plugin » du composer pré-remplit un brouillon — comportement normal.
- **Toast « Copy: ~/.dsh/kybernos/kyby »** : apparu pendant la session de test, non reproduit depuis — non tranché.
- **Page Account externe** (« opening in your browser ») : comportement voulu (console link), muet en headless par conception.

## 5. Non tranchés / en attente

- **check-memory-live 3 ✗ à 390 px** : la page Memories/Lessons ne s'ouvre pas à la largeur téléphone — candidat défaut mobile, hors périmètre desktop de cette campagne, à qualifier côté mobile.

- **Passe vision glm-5.3-flash** : 30 captures prêtes, lecture bloquée ce soir — 10 routes épuisées (ollama-cloud clé 401 morte, ZAI glm-5v-turbo quota 429 persistant, dashscope 401, openrouter 402, nvidia 410, deepinfra 404, gateway Vercel local éteint, gmicloud 403, gemini 404, qwen3.5 local non multimodal). → **Action utilisateur possible : nouvelle clé ollama-cloud, ou attendre le reset du quota ZAI.**
- L'homogénéité graphique fine (comparaisons visuelles pixel entre surfaces) est couverte par `check-cardface-live` (59 ✓) mais la relecture visuelle humaine/modelle des captures reste à faire.

## 6. Ledger

| Vague | Couloirs | Constats uniques | Écarts | Corrections | Preuves | Rapport |
|---|---|---|---|---|---|---|
| R1-2 Vague 0 inventaire | 12 surfaces + Settings ×9 | 5 | 0 | 0 | 21 PNG | vague0-matrice.md |
| R3-4 batteries :3080 | 7 scripts | +2 (#9→P2 lang, #10 thème) | 2 faux nég. | 0 | sorties scripts | idem |
| R5-6 sandbox + réfutations | 5 scripts + 2 manuels | +0 (réfutations) | 24 ✗ expliqués | 0 | captures | idem |
| R7-9 batteries 2 + réfutations | 16 scripts + 3 manuels | +1 (17,5 px) | 61 ✗ expliqués | 0 | 34 PNG cumulés | idem |
| R10 thème sombre | 3 panneaux dark | +0 | 0 | 0 | 34 PNG | idem |

Signal d'arrêt : les deux dernières vagues n'ont apporté aucun constat unique nouveau → campagne close sur la partie accessible.

## 7. Verdict GO/NO-GO

| Axe | Verdict |
|---|---|
| Fonctionnalité pages/boutons (GUI) | **GO** — aucun parcours bloqué trouvé |
| Plugins/bundles (boot, panneaux, persistance) | **GO** — tous les panneaux vivants, écriture disque prouvée |
| Homogénéité graphique | **GO** (cardface 59 ✓) — relecture visuelle différée |
| Thèmes clair/sombre | **GO** — captures 2 thèmes, persistance prouvée |
| i18n | **GO avec réserve** — P2 #1 : traiter la barre latérale avant une cible 100 % FR |
| Configuration | **GO** — toggles persistants prouvés |
| Passe vision | **EN ATTENTE** — route modelle indisponible ce soir |

Recommandations avant prod : corriger #2 (409 console, bruit visible dans tout test), arbitrer #3/#5 (libellés), nettoyer #4 (doublon), plancher #1 (i18n sidebar).

## 8. Passe vision (glm-5.3-flash, 34/34 captures — via ZCode/coding plan Z.AI)

Route retenue : **connecteur ZCode (compte coding plan Z.AI, GLM-5.3-Flash)** après échec des 10 routes API (clé ollama-cloud morte, quotas).

### Nouveaux constats vision (P2/WARN, à trier)

| # | Sev | Constat | Preuve |
|---|-----|---------|--------|
| 7 | P2 | Contraste faible récurrent : étapes 2-3 de l'aide Skills en gris très pâle, suggestion 3D « draw a lighthouse in 3D » gris pâle, aperçus des cartes Creations en gris minuscule quasi illisible | captures v0-skills, v1-panel-3d, v0-creations |
| 8 | WARN | Compteurs incohérents : sidebar « Skills 17 » vs onglet « Yours 46 » ; « Automations 1 » parfois, absent d'autres fois ; LAST SESSION tronqué (« … · … ») | v0-skills, v0-automations, v1-automations-dark |
| 9 | WARN | Descriptions Connectors tronquées en milieu de mot (« …reminders acro… », « …G Site... ») | v0-connectors, v1-connectors-dark |
| 10 | WARN | Popover « MY ANIMATIONS » (Motion) laisse un fragment orphelin « logo..., » flottant ; panneaux vides incohérents entre eux (barre de transport sur Slides/3D vides, absente sur Motion vide) | v1-motion-list, v1-panel-motion |
| 11 | WARN | Mobile 390 px : fragment d'onglet résiduel « n » coupé au bord gauche ; légère troncature de légende | v2-phone-390-accueil |
| 12 | WARN | Titres d'onglets volet droit tronqués, ✕ collé au texte (« 3D model… ✕ ») | v1-panel-3d |

### Confirmations vision
- Doublon « Usage and tokens 2 » **revu et confirmé par la vision** (#4)
- Deck démo Slides 5/5 : rendu propre, outils complets
- Démo 3D Lighthouse : « modèle net, rendu propre », 9/9 objets

### Non-défauts tranchés par la passe vision
- Settings « contenu General sur 9 captures » : **accordéon normal** (groupe ≠ feuille) — cliquer la feuille « Voice » charge bien sa page (vérifié en live)
- Brouillons tronqués en haut de capture : cadrage de capture, pas l'app
- « Samples Teting » : nom de workspace créé par l'utilisateur, pas l'app

**Verdict final inchangé : GO** — aucun défaut bloquant ; 12 constats (3 P2 initiaux + P2 contraste + 8 WARN) tous cosmétiques/contenu.
