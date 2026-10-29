# Recette « plateforme plugins + serveur » — récap des fonctionnalités et plan

- Date : 2026-10-20 (Europe/Paris)
- Dépôt : `~/kybernos-plugins` @ `c7cce85` (dev), VERSION 0.1.1
- Instance testée : DSH `http://127.0.0.1:3080`, pid 18941, sans supervision launchd
- Mode demandé : recette **boîte noire** (« sans code ») — on prouve par DOM, captures, fichiers disque et codes HTTP ; aucune correction pendant la campagne
- Campagne précédente : `campagne-recette-2026-10-19/` — 421 checks verts, 12 constats, GO ; **périmètre exclu : serveur kybernos, compte, billing** → c'est le trou que celle-ci comble

## 1. La plateforme plugins (ce qu'on recette)

### 1.1 Socle et gestion des modules

| Brique | Fonctionnalité |
|---|---|
| Catalogue | **42 modules** au catalogue signé, **7 familles** : base 17, create 9, connect 5, models 4, teams 3, cloud 3, data 1 |
| Bundle | Chaque dossier de `packages/` est un bundle DSH indépendant (client + hôte, `dsh` block) ; 39 bundles Kybernos + 2 processus autonomes (`messaging`, `gate`) + 1 service (`skills-index`) |
| Socle | Toujours actif : `kybernos-plugin` (crew, journal, réglages, catalogue d'outils, routes hôte, preset de compactage), `-hub`, `-theme`, `-sessions`, `-skills` ; les autres se coupent |
| Panneau Suite | Settings ▸ Kybernos Suite : onglets All / **Featured** / Installed / Available / Updates, puces par famille, recherche, grille ou liste, **ordre réordonnable** (localStorage), page module (description + compatibilité), switch, bouton Settings direct, install/update |
| Mises à jour | Catalogue en ligne **signé uniquement**, « Check for updates » puis « Update the suite » (une relance) ; un checkout de dev se met à jour par git, jamais par ce bouton |
| Compatibilité | `dsh-compat.json` (plage de versions DSH testées) ; pastille affichée hors plage ; gate de compat dans les tests |
| Garde de boot | `hub` enregistre les 12 derniers boots, beacons `loading` / `broken` / `alive` ; 2 boots ratés → **safe mode recommandé** (jamais appliqué tout seul) |
| Relance | `relancer_dsh` (panneau d'approbation natif si d'autres sessions tournent), reprise des sessions après relance, supervision launchd optionnelle |

### 1.2 Surfaces produit visibles (parcours de recette)

- **Navigation gauche** : Kaby, Dashboards, Agent Teams, Workspaces, Creations, Automations, Skills, Connectors, Atlas, Recherche globale (⌘K), sessions récentes, compteurs.
- **Chat** : composer (Documents/Media/Apps/Automate, modes Standard / Full access, choix du modèle), brouillons persistants, chips *Changes* et *Usage* sous le composer, résumé de tour.
- **Volet droit (mini-apps)** : Summary, Databases, Bricks, Slides, 3D modeller, Motion, Dashboard, Kaby, Agent Teams — plus « Install as app ».
- **Settings** : 9 groupes (General, Interface, Memory & context, System, Devices & cloud [dont **Servers**], Models & routing, Skills & tools, Agents, Voice & calls) + pages de modules (Suite, Language, Usage, Workers, About, Memory & Lessons, Sessions, Auto routing, Composio, Cloud/Computer).
- **Intégration chat** : outils hôte (`creer_slides`, `creer_motion`, `animer_briques`, `modeliser`, `kybernos_dashboard`, `lesson_*`, `relancer_dsh`, ordinateurs cloud…), catalogue de skills natif, commandes slash et actions de message, mémoire/leçons par équipe, auto-routing par classe, LLM gratuits, Ollama local, websearch, terminal, mermaid, lecteur média, puces de références.
- **Connecteurs** : Composio (MCP + catalogue d'apps), ordinateurs cloud E2B, workers externes (Claude Code, Codex, Gemini, OpenCode, Qwen, Hermes), appels vocaux LiveKit, passerelle messagerie Telegram, mobile/PWA.

### 1.3 Munitions de recette déjà dans le dépôt

- **83 scripts `scripts/check-*-live.mjs`** (cardface, settings-nav, menu-density, connectors, skills, automations, mobile, workers, servers, gate…), dont certains écrivent → ils **refusent :3080** et exigent la sandbox (`scripts/sandbox`, HOME + DSH_HOME isolés).
- Suites par paquet (`packages/*/test*.mjs`), robot cycle de vie, packaging, safe mode, garde-dépôt.
- Campagne 2026-10-19 : 421 checks verts, 12 constats, méthode et pièges déjà documentés (`campagne-recette-2026-10-19/RAPPORT-RECETTE.md`).

## 2. La plateforme serveur (ce qu'on recette)

### 2.1 Modèle serveur

- **Un seul serveur Kybernos actif** à la fois. Serveur intégré = **Kybernos Cloud** (`api.kybernos.app`, nommé une seule fois : `BUILTIN_API`).
- **Registre** : `~/.dsh/kybernos/servers.json` = `{active, servers:[profil…]}`. Profil minimal : `id`, `name`, `api` ; optionnels `web`, `console`, `services.llm`, `services.connections`.
- **Contrat d'un serveur** (version 1) : document de découverte `GET <adresse>/.well-known/kybernos-server.json` (200 JSON, sans redirection, < 64 Ko, < 8 s) ; `api` obligatoire ; https exigé (http toléré en loopback seulement) ; un champ présent mais invalide **refuse tout le profil** (jamais de repli sur un autre serveur).
- **Entrées rejetées** et listées : invalide, dupliquée, `duplicate_builtin` (une saisie manuelle du même `api` que le serveur intégré), id réservé `kybernos-cloud`.
- **Un fichier de connexion par serveur** : `kybernos-cloud.json` pour l'intégré, `kybernos-cloud-<id>.json` (0600) pour les autres → changer de serveur **ne déconnecte personne** et le jeton d'un serveur ne part jamais vers un autre.
- **Bascule** : nettoie d'abord la route modèle du serveur quitté, marque le nouveau, importe son catalogue s'il est connecté ; le chat ne continue jamais de parler à l'ancien serveur. Idempotent, same-origin gardé.
- **Facturation** : l'en-tête `x-kybernos-workspace` porté par la route modèle = espace actif (équipe vs personnel) ; `GET /kybernos-cloud/quota` expose le motif de refus et les fenêtres en % ; carte Cloud (plan, jauge, « Sign in again » si appareil oublié).
- **Serveur sans LLM** : `services.llm:false` est un cas normal — aucun modèle « kybernos » importé, les modèles laissés par un autre serveur sont retirés.
- **Apps connectées** : `services.connections` = endpoint MCP du serveur (`/v1/mcp/connections`), même origine que `api` obligatoire ; absent = non proposé.

### 2.2 Page Servers (parcours 3 gestes)

1. Coller l'adresse → l'hôte lit le document de découverte (trois étapes : répond / publie un profil / convient à ce DSH) et affiche le nom + où ira la connexion.
2. « Add and sign in » → écrit `servers.json`, vérifie que le profil est accepté (sinon remet le fichier exactement comme avant), applique le changement.
3. Appairage par code d'appareil (`/kybernos-cloud/start` puis `/poll`) contre l'`api` de ce serveur. Renommer / retirer / basculer. **Ni licence ni clé** : le serveur décide qui a un compte.

### 2.3 Instance hébergée (serveur exposé)

- `dsh web` **refuse** `--host 0.0.0.0` : loopback + proxy sur la même machine ; nom public déclaré par `--trusted-host`.
- DSH sert les routes plugin **avant** sa propre authentification → chaque bundle garde son `Origin` (règle socket, pas `Host`), plus une autorité déclarée (`kbTrusted`). Matrice mesurée : Origin public 200, Origin `evil.example` 403, `Host` forgé 403.
- **Kybernos Gate** : page de login (un seul mot de passe), session signée, reverse proxy HTTP/SSE/WebSocket, et **remise à DSH de son propre cookie** → un seul login, jamais la page « authentication required » ; `/__gate/health` ; refuse de démarrer sans mot de passe ; image Docker + unit systemd + proxy TLS devant.
- Effets d'un hébergement : réglages UI de DSH en mémoire hors loopback (notice d'aperçu neutralisée par le socle), profil `~/.dsh` sur volume persistant.

## 3. État mesuré ce soir (preuves de départ)

| Point | Mesure |
|---|---|
| DSH | :3080 répond, pid 18941, **aucune autre session**, pas de supervision launchd |
| Bundles liés au profil `web` | **42/42** (`~/.dsh/profiles/web/node_modules/@local/`) |
| Routes hôte | `/kybernos-hub/suite` 200, `/kybernos-cloud/server` 200 |
| Serveur actif | `kybernos-dev` (`server-dev-7831.up.railway.app`), connecté ; 3 profils au registre (`kybernos-cloud`, `kybernos-local`, `kybernos-dev`) ; `kybernos-prod` **rejeté `duplicate_builtin`** (cas réel du contrat) |
| Découverte | dev 200 (0,18 s, LLM + connections), prod 200 (0,10 s) |
| Batteries | 83 scripts live ; campagne précédente 421 checks verts |

## 4. Ce que la recette boîte noire peut prouver — et ses pièges

**Testable sans aucun compte / sans clé** : parcours complet de la page Servers contre un **serveur factice local** (le dépôt en embarque un dans `check-servers-live.mjs` : découverte, appairage, code approuvé côté admin), refus (adresse muette, http non-loopback, profil invalide, doublon, id réservé), écriture disque du registre + fichiers de connexion 0600, bascule et nettoyage de route, serveur sans LLM, régression au boot ; **gate** en avant d'un DSH isolé (mauvais/bon mot de passe, cookie, `/api`, SSE, sans cookie = bloqué, matrice Origin/`--trusted-host`) ; panneau Suite (filtres, ordre, compatibilité, switch d'un satellite + restauration), garde de boot et safe mode en sandbox, relance approuvée.

**Demande ton accord / ton compte** : appairage réel sur le serveur dev, carte quota/plan, lien console, facturation par espace, apps connectées via le serveur.

**Pièges déjà payés (à ne pas refaire)** :
- sandbox **dégradée** quand le lien du module payant `kybernos-servers` manque → faux négatifs « le panneau ne s'ouvre pas » + `sessionController unavailable` ; réfuter à la main sur :3080 ;
- le thème **se synchronise par disque** entre navigateurs → un script de test bascule le thème réel ;
- **vision** : jamais ZCode (décision 2026-10-20) ; routes directes seulement (ollama-cloud, Z.AI) ;
- Settings est un **accordéon** : cliquer un groupe n'ouvre pas une page, seule une feuille change le contenu ;
- checks écrivants → sandbox obligatoire ; ne jamais les lancer sur :3080 ;
- bruit connu : 409 `/kybernos-hub/catalogue/refresh`, sidebar en anglais (i18n).

## 5. Plan de campagne proposé (6 vagues, ~2 h 30, 2 couloirs)

| Vague | Durée | Contenu | Preuves |
|---|---|---|---|
| V0 | 15 min | Smoke : statut, log de boot, preset de compactage ; **inventaire des 2 axes** (plugins / serveur) ; matrice de couverture | captures + DOM |
| V1 | 30 min | **Panneau Suite** : featured/filtres/recherche/ordre/détails/compatibilité ; switch d'un satellite (ex. `kybernos-refs`) → disque + boot vert + **restauration** ; « Check for updates » (catalogue signé) ; garde de boot + safe mode (sandbox) ; relance approuvée | DOM + fichiers + captures |
| V2 | 40 min | **Servers (sandbox)** : parcours complet serveur factice (add → découverte → sign in → code → rename → switch → remove) ; refus ; registre + fichiers 0600 ; nettoyage de route ; serveur sans LLM ; régression au boot | HTTP + disque + captures |
| V3 | 30 min | **Gate / hébergé** : DSH isolé + gate ; mauvais/bon mot de passe ; cookie DSH ; `/api`, SSE, WS ; sans cookie = bloqué ; `--trusted-host` 403→200 | codes HTTP + captures |
| V4 | 20 min | **Serveur réel (dev)** en lecture : quota/plan/catalogue/console link, cohérence des profils, apps connectées — appairage seulement sur accord | réponses route + captures |
| V5 | 25 min | **Vision** (glm-5.3-flash, routes directes) sur les captures neuves + **rapport GO/NO-GO par axe** (`rapport-campagne-bugs`) | rapport |

Livrables : `campagne-recette-2026-10-20/` — matrice, captures nommées, preuves disque, rapport, ledger. Un constat = une preuve ; lots de 10 ; arrêt après deux vagues sans constat unique.

## 6. Décisions à prendre

1. **Périmètre** : (A) local + sandbox + serveur factice + gate — aucun compte requis *(recommandé)* ; (B) A + serveur dev réel complet (appairage, quota, billing) ; (C) plugins seulement.
2. **Couloirs** : solo (moi) ou 2 équipiers (plugins / serveur) en parallèle — mêmes règles de preuve.
