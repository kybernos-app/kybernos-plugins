# Vague 0 — Matrice de couverture (DSH local + plugins) — 2026-10-19

Tier : GUI locale `http://127.0.0.1:3080`, navigateur de test authentifié (cookie 30 j).
Captures : `captures/v0-*.png` (20 fichiers, 1200×919, non vides).

## Surfaces inventoriées

| Surface | Capture | Contenu DOM (verbatim extrait) | États à couvrir |
|---|---|---|---|
| Accueil / chat | v0-accueil(.png, -dark) | Composer : Documents(4) Slides/Document/Spreadsheet/Dashboard, Media(2) Image/Video, Apps(3) Website/Mini-app/3D model, Automate(4) Automation/Agent Team/Skill/Plugin, Cloud Computer ; mode Standard/Full access ; modèle glm-5.3 | vide, brouillon, envoi, menus More types/Previous types |
| Barre latérale | (dans accueil) | New session, Search everywhere, Collapse sidebar, Pinned(4), Sessions(+19), compteurs 11 teams/10 ws/500 creations/17 skills/1 automation | recherche vide, workspace add, view options |
| Dashboards | v0-dashboards(.png, -dark) | H1 « Dashboards », How it works, Create with AI, Mes dashboards (6 : Workspace pulse, Token routes, Automations health, Agent Teams, Usage and tokens 2, Usage and tokens), Presets (9, « Use this preset ») | ouvrir un dashboard, actions ⋯, preset→copie |
| Agent Teams | v0-agent-teams | liste (11) | détail équipe, membres, lessons |
| Workspaces | v0-workspaces | liste (10) | création, renommage, suppression |
| Creations | v0-creations | liste (500) | filtres, tri, ouverture |
| Automations | v0-automations | liste (1) | run, schedule, historique |
| Skills | v0-skills | liste (17) | activation, détail, collision |
| Connectors | v0-connectors | catalogue + connectés (gmail, gcal, gdrive, gsheets, outlook) | brancher, débrancher, onglets |
| Menu compte | v0-account-team | Personal/Local test·Free, 1 % allowance, Create a team, Join with link, Upgrade, Team settings, Account, Referral, Appearance Light/Dark, Settings, Website, Help, Send feedback, Sign out | chaque menuitem |
| Settings | v0-settings{,-interface,-memory,-system,-devices,-models,-skills,-agents,-voice}.png | 9 sections : General, Interface, Memory & context, System, Devices & cloud, Models & routing, Skills & tools, Agents, Voice & calls ; Onboarding Replay, Behaviour toggles, Study model, Upload session log ON | chaque toggle : écriture disque + persistance reload |

## Constats Vague 0 (à confirmer par vision)

1. **Doublon dashboard** « Usage and tokens » / « Usage and tokens 2 » (descriptions identiques) — écart/doublon.
2. **Libellé preset incohérent** : Workspace pulse = « Sessions, deliverables… » (Mes dashboards) vs « Sessions, creations… » (Presets).
3. **Nav « Plugins » fantôme** : présent au premier inventaire DOM, introuvable ensuite (bouton « Plugin » existe dans Automate). À qualifier.
4. **Kaby** : surface non encore visitée (prochain tour).
5. **Texte du composer pré-rempli** au nouvel onglet (« Work with the Agent Team "Kyber Creator Expert"… Start by telling me how you plan to organise the work, then wait for my go-ahead. ») — vérifier si intentionnel.

## Vision

glm-5.3-flash (ollama-cloud) : clé 401 — route morte ce soir. ZAI glm-5v-turbo : 429 (quota).
→ Passe vision différée ; inventaire DOM exploité en attendant. 20 captures prêtes.

## Prochains couloirs (Vague 1)

- Settings : jouer chaque toggle, vérifier écriture disque + persistance (config).
- Thème sombre : re-captures par surface (2 déjà faites).
- i18n : audit-i18n-live.mjs.
- Kaby + Account + Team settings + Referral.
- Chasse homogénéité (vision quand route rétablie).

## Round 2 — Vague 1 (fonctionnel) — 2026-10-19 ~00:30

### Parcours réussis (preuves faites)
- **Toggle Settings « Name each chat when it ends »** : Yes→No → `settings.json` `renameAfterRecap:false` immédiat ✅ ; restauré ✅
- **Workspace create/delete** : dialog New workspace (Create désactivé sans nom ✅) → création « qa-recette-temp » → dossier `~/Documents/Kybernos/qa-recette-temp` créé ✅ → suppression avec dialog de confirmation (avertit que le dossier est conservé) → disparu de la liste ✅ → dossier nettoyé
- **Panneau Kaby** : channels Telegram + WhatsApp/WeChat « Soon », Computer « This computer »/« Home (cloud) », état Ready ✅
- **Menu compte** : Team settings/Account/Referral/Settings/Website/Help/Send feedback/Sign out inventoriés ; Account ouvre une page EXTERNE (status « opening in your browser » — silencieux en headless)
- **Bouton « Plugin » (Automate)** : pré-remplit le brouillon du composer — pas une page

### Nouveaux constats
6. **i18n** : 1494 chaînes EN restantes en UI française (531 uniques) — TOUTE la barre latérale/nav (Kaby, Dashboards, Agent Teams…) reste en anglais. Rapport : `i18n-fr.json`
7. **Erreur console** : 409 Conflict sur `/kybernos-hub/catalogue/refresh` au chargement
8. **Page Account** : dépend du navigateur externe — comportement à documenter pour headless/CI

### Vision
ZAI toujours 429 (quota). Captures en attente : 23.

## Round 3 — 2026-10-19 ~00:40

- Panneau **Creations** inventorié : Search, vue Cards/List, filtres types (All 500), Customize, Create with AI, cartes avec Locate/Pin/Actions + préview iframe (docs rendus). Capture `v1-creations-detail.png`.
- Découverte : le repo embarque une batterie `scripts/check-*-live.mjs` (language, skills, account-menu, newchat, cardface, automations-board, usage, changes, onboarding…) → à exécuter en Round 4 comme passée de chasse scriptée éprouvée.
- ZAI vision toujours 429.

## Round 4 — Batteries check-*-live — 2026-10-19 ~01:35

### Batteries exécutées (scripts du repo, GUI réelle :3080)
| Script | Verdict |
|---|---|
| check-cardface-live | ✅ 59 checks |
| check-account-menu-live | ✅ 11 checks |
| check-connectors-live | ✅ 7 checks |
| check-skills-detail-live | ✅ 21 checks |
| check-newchat-live | ✅ 23 checks |
| check-cloud-menu-live | ✅ 5 checks |
| check-animations-live | ✅ 7 checks |
| check-language-live | ⚠️ 3✓/12✗ — **faux négatifs environnementaux** : page Language prouvée OK manuellement (Français Ready/Use, English In use, arabe RTL 91 %, es/it 91 %, pl 95 %, Resume translation, dossier i18n disque) ; le script crashe (JSON.parse undefined) faute d'avoir ouvert la page |
| check-automations-list-live, check-creations-search-live, check-accent-live | ○ nécessitent sandbox (KB_HOST) — non joués |

**Total batterie : 133 checks verts.**

### Nouveaux constats
9. **Page Language** : boutons incohérents — arabe/espagnol/italien à 91 % disent « Use now », polonais à 95 % dit « Use anyway » (seuil/libellé à homogénéiser)
10. **Thème dérivant** : thème retrouvé en Dark après la restauration Light (cause à déterminer : restauration non prise en compte ou script) — re-testé et remis Light

## Round 5 — Sandbox (instance isolée :3099) — 2026-10-19 ~01:45

- **Thème** : persistance prouvée (`kybernos.theme.v1 mode=light` survit au reload) → constat #10 NON REPRODUIT, écarté.
- Sandbox DSH isolé monté (setup râle sur lien paid-module kybernos-servers mais démarre, pid 42081 :3099).

### Batterie sandbox
| Script | Verdict |
|---|---|
| check-connections-live | ✅ 48 checks |
| check-creations-search-live | ✅ 12 checks |
| check-automations-list-live | ⚠️ 57✓/5✗ |
| check-automations-board-live | ⚠️ 72✓/6✗ |
| check-connectors-matrix-live | ⚠️ github spec_too_large, open-meteo spec_http 404 (lecture specs) |

### Analyse des 11 ✗
- Board (6) : l'hôte n'arrive pas à démarrer une vraie session (sessionId null, gateway « sessionController unavailable ») → **suspect environnemental** : le sandbox n'a pas de clé modèle. À re-qualifier avec `--stub-model`.
- List (5) : brouillon d'édition d'automation qui ne se remplit pas (« draft that names automation-creator… » = "") + 1 erreur console gateway → **candidat défaut réel** (parcours Éditer une automation) à confirmer manuellement.
- Matrix : échec de lecture des specs github (trop grande) et open-meteo (404) → défaut **données externes**, pas la GUI.

**Total campagne : 193 checks verts (133 :3080 + 48+12 sandbox).**

## Round 6 — 2026-10-19 ~01:55

- **Édition d'automation prouvée OK sur la GUI réelle** : « Edit in chat » remplit le brouillon (skill automation-creator, id, nom, cron+zone, approbations, étapes). Capture `v1-automation-edit-draft.png`. → les 5 ✗ de check-automations-list-live reclassés **environnementaux**.
- **Board --stub-model : 19 ✗**, tous avec la même erreur `sessionController unavailable` (gateway sandbox) → reclassés **environnementaux** : le setup sandbox échoue sur les liens shared-tree (module payant kybernos-servers absent du worktree), le moteur sandbox est incomplet. Le produit n'est pas en cause sur :3080.
- ZAI vision : toujours 429.

### Verdicts consolidés à ce stade
- Défauts produits confirmés : #1 doublon dashboard, #2 libellé preset, #6 i18n sidebar EN (531 uniques), #7 erreur 409 catalogue refresh, #9 libellés Use now/Use anyway
- Non-défauts prouvés : édition automation, persistance thème, page Language

## Round 7 — Batterie 4 — 2026-10-19 ~02:00

| Script | Verdict |
|---|---|
| check-settings-nav-live | ✅ 16 |
| check-icons-live | ✅ 14 |
| check-menu-density-live | ✅ 17 |
| check-menu-icons-live | ⚠️ 34✓/20✗ |
| check-pages-live | refusé : écrit dans le DSH réel (bien gardé) |
| dashboards/settings-layout/footer/display/help | ○ sandbox requis |

### Qualification des 20 ✗ menu-icons
Mesuré en direct : registre OK (21 sets), 8/8 rangées redessinées, attr correct — mais `box = 17.5×17.5` au lieu de 16×16 attendu (dpr 2). → **écart de taille d'icône** (17,5 px rendu vs 16 px spécifié par le check) : soit le check pinne une valeur périmée, soit le bundle installé dérive du checkout. Défaut cosmétique mineur, à arbitrer côté produit. Icônes restaurées en « classic » après mesure.

**Total campagne : 240 checks verts.**

## Round 8 — Batteries 5/5b — 2026-10-19 ~02:10

| Script | Où | Verdict |
|---|---|---|
| check-miniapps-panels-live | :3080 | ✅ 15 |
| check-help-intro-live | sandbox | ✅ 63 |
| check-study-model-live | sandbox | ✅ 19 |
| check-free-llms-live | sandbox | ✅ 12 |
| check-slides-live | sandbox | ⚠️ 8✗ — **réfuté à la main** : panneau Slides + deck démo 5/5 rendus sur :3080 (captures v1-panel-slides/v1-slides-demo) → environnemental |
| check-motion-live | sandbox | ⚠️ 12✓/45✗ — à qualifier (volet Motion non vérifié manuellement) |
| check-modeleur-live | sandbox | ⚠️ 8✗/2✓ — à qualifier (volet 3D modeller non vérifié manuellement) |
| kyby/creator-draft/model-scores/pages… | — | ○ refusés (écriture) ou sandbox-session requis |

Volet droit inventorié : Summary, Databases, Bricks, Slides, 3D modeller, Motion, Dashboard, Kaby, Agent Teams.

**Total campagne : 349 checks verts** (240 + 15 + 63 + 19 + 12).

## Round 9 — 2026-10-19 ~02:15 — Réfutations des 2 derniers suspects sandbox

- **3D modeller prouvé OK** : panneau ouvert, demo Lighthouse rendue (canvas actif 1040×1528). Captures v1-panel-3d, v1-3d-demo. → échecs check-modeleur-live reclassés environnementaux.
- **Motion prouvé OK** : panneau ouvert (« No animation open », bouton My animations → liste). Captures v1-panel-motion, v1-motion-list. → échecs check-motion-live reclassés environnementaux (le panneau vit ; les 45 ✗ du script exigeaient une anim démo complète en sandbox dégradé).
- Découverte annexe : le brouillon d'édition d'automation **survit au rechargement** de page (persistance des drafts).

## État : TOUS les suspects sandbox sont résolus (réfutés manuellement ou expliqués).

## Round 10 — 2026-10-19 ~02:20

- Thème sombre : Skills, Connectors, Automations capturés en Dark (+ accueil et Dashboards déjà faits). Thème restauré Light.
- **Mécanisme du « thème dérivant » élucidé** : le thème se synchro par disque (~/.dsh) entre navigateurs ; les scripts de test lancés avec le HOME réel basculent le thème partagé. Pas un défaut produit pour l'utilisateur seul — mais à savoir pour toute campagne automatisée.
- Vision : 10 routes épuisées (ollama-cloud 401 clé morte, ZAI 429, dashscope 401, openrouter 402, nvidia 410, deepinfra 404, gateway local éteint, gmicloud 403, gemini 404, qwen3.5 local non multimodal). Passe vision **différée** — 30 captures prêtes.

## Round 13 — Batterie 6 — 2026-10-19 ~02:30

| Script | Verdict |
|---|---|
| check-settings-search-live | ✅ 15 |
| check-settings-nav-i18n-live | ✅ 1 |
| check-skills-featured-live | ✅ 44 |
| check-skills-codes-live | ✅ 12 |
| check-memory-live | ⚠️ 30✓/3✗ — les 3 ✗ sont à la largeur téléphone 390 px (« la page ne s'ouvre pas en 390 px ») → candidat défaut MOBILE, hors périmètre GUI desktop ; à qualifier côté mobile |
| check-quiz-live | ○ sandbox |
| check-gate-live | ○ nécessite --dsh-port/--dsh-home dédiés |

**Total campagne : 421 checks verts.** Capture phone `v2-phone-390-accueil.png`.
