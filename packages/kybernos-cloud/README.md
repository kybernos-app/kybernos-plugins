# Kybernos Cloud — plugin DSH

Connecte DSH à un compte **Kybernos Cloud** et affiche le profil dans l'interface :
email, nom, formule, workspaces (nom + nombre de kybers) et état de la session.
À la connexion, **import automatique des modèles** du proxy Kybernos LiteLLM
(glm, deepseek…) selon l'abonnement — voir « Catalogue de modèles importé ».

Un bouton dans la barre du bas de la sidebar — dans le slot
`sidebar.footer.action`, à côté de Settings — ouvre une carte à trois états :

| État | Ce qu'on voit |
|---|---|
| Déconnecté | « Connecter Kybernos Cloud » |
| Appairage | le code d'appareil, « Ouvrir la page d'activation », « Copier le code », « Annuler la demande » |
| Connecté | profil + workspaces + résumé du catalogue (N modèles · formule), « Réimporter », « Rafraîchir », « Se déconnecter » |

## Catalogue de modèles importé (fonctionnalité cloud n°1)

Quand l'utilisateur est connecté, le half host importe automatiquement le
catalogue du proxy Kybernos LiteLLM dans le harnais :

```
GET https://api.dev.kybernos.app/v1/models        (Authorization: Bearer kys-…)
   → { data: [{ id: 'kybernos/doer', … }, …] }    (liste OpenAI-compatible)
```

- **Écrit dans `~/.dsh/settings.yaml`** (namespace `llm-pi-ai`) une route
  provider `kybernos` : `displayName: Kybernos Cloud`, `api: openai-completions`,
  `baseURL: https://api.dev.kybernos.app/v1`, `apiKeyEnv: KYBERNOS_API_KEY`,
  `models: [{ id, name }, …]`. L'écriture passe par le service `settings`
  (le même chemin que la page Models native) — les modèles apparaissent dans
  Settings → Models et dans le sélecteur de modèles, sans redémarrage.
- **Pose le credential** `KYBERNOS_API_KEY` (le jeton `kys-…`) dans le store
  de credentials (`~/.dsh/.credentials.yaml`, 0600). Le harnais résout la
  référence à chaque requête : aucun secret dans settings.yaml.
- **Filtre la surface produit** : seules les routes `kybernos/*` sont gardées —
  pas les jumeaux de fallback (`-fb1`, `-fb2`…), pas les pools de routage infra
  (`*_rg`), pas la route embeddings (`kybernos/embed`). `max_tokens` /
  `context_length` du catalogue sont repris quand LiteLLM les fournit.
- **Déclencheurs** : au claim (connexion), au démarrage de DSH si déjà
  connecté, au refresh si rien n'a encore été importé, et à la demande
  (POST `/kybernos-cloud/models/sync` — bouton « Réimporter »). Un import à
  l'identique ne réécrit rien (pas de churn settings à chaque ouverture de
  carte).
- **L'abonnement est appliqué par le proxy**, requête par requête (gating
  free < solo < studio < scale, fail-closed) : le catalogue `GET /v1/models`
  n'est pas filtré par formule, donc DSH n'importe pas de logique de tiers —
  un modèle hors formule répondra l'erreur du proxy à l'appel.
- **Nettoyage** : « Se déconnecter » ou une révocation retire la route
  `providers.kybernos` ET le credential — mais uniquement ce que CETTE
  fonctionnalité a posé (traçé dans l'état : `models.provider`).
- **Dégradation** : catalogue 401/illisible/injoignable → refus explicite
  (`catalogue_refuse`, `catalogue_illisible`, `reseau`), jamais de
  déconnexion (la révocation se décide sur `/v1/workspaces`) et l'import
  précédent reste en place ; services `settings`/`credentials` absents →
  `settings_absent`, motif affiché dans la carte.

Nouvelles routes locales :

| Route | Réponse |
|---|---|
| `GET /kybernos-cloud/models` | `{ok, connected, plan, models:{provider, base_url, imported_at, plan, count, ids, settings, credential, cause}}` |
| `POST /kybernos-cloud/models/sync` | même contrat + `wrote`/`reason` — resynchronise maintenant (force) |

Le résumé (`count`, `plan`, `imported_at`, `settings`, `credential`) voyage
aussi dans `state` des réponses `/status`, `/poll` et `/refresh`. Les ids
complets restent dans la route de détail.

## Mémoire du compte (fonctionnalité cloud n°2)

DSH n'a **aucune mémoire native** : son plan d'instructions est plafonné à
65 536 octets (`maxBytes` des presets) et, au-delà, le chargeur **omet** les
fichiers les moins spécifiques. Les souvenirs durables de l'utilisateur vivent
donc là où ils sont déjà modélisés : la table `kybernos.memories` de son compte.

Quand le compte est connecté, ce half fait trois choses :

1. **Il lit** `GET /v1/memories?scope=account` (et `?scope=kyber&kyber_id=` pour
   chaque kyber relié) avec le jeton du compte, et remplit un cache. Le cache est **rechargé** quand il a plus de 60 s (minuteur du plugin, libéré avec lui), juste après toute écriture (outil, capture, carte) et à l'ouverture de la page ; une lecture qui échoue **garde** l'ancien contenu et remonte l'erreur au lieu de vider le prompt.
2. **Il injecte** le résultat dans le prompt, à chaque assemblage, via
   `ctx.systemPrompt.context({ name: 'kybernos:memory', order: 130, text })`.
   Le texte est **synchrone** (il lit le cache — jamais le réseau dans un
   assemblage), borné à 6 000 caractères **cadre compris**. La
   **sélection** se fait par fraîcheur : les épinglés d'abord (plafonnés à 60 % du
   budget, les plus récents d'abord), puis les souvenirs libres les plus récents, et
   un souvenir trop long pour ce qui reste est sauté. Le **rendu** garde l'ordre
   déterministe de la spec serveur (`pinned DESC, created_at ASC, id ASC`, un ordre
   instable casse le prompt caching du proxy). L'ancien tri « du plus ancien au plus
   récent, coupe au premier dépassement » ne gardait que les plus vieux : sur un compte
   à 631 souvenirs, seuls 12 épinglés entraient et rien de ce que le modèle venait
   d'apprendre. Quand des souvenirs restent dehors, le chunk le dit et renvoie à
   `memory_search`. Les kybers reliés ont leur part (30 %) pour qu'un groupe n'affame
   pas l'autre. C'est une étape **provisoire** : la vraie réponse est une recherche par
   pertinence côté serveur. Le contenu est neutralisé : un souvenir ne
   peut pas fabriquer une ligne de chunk.
3. **Il laisse écrire** : deux outils (`memory_write`, `memory_search`) et une
   **capture automatique en fin de tour** (`agent/turn-stopping`) qui demande au
   modèle en place, en tâche de fond (300 jetons max), ce qui mérite d'être
   retenu — puis l'écrit dans le compte (`kind` au choix du modèle, `source:
   conversation`). Ce hook est attendu **sériellement** par la boucle d'agent :
   la capture est donc *fire-and-forget*, elle ne retarde jamais la fin du tour.
   Le texte soumis à l'extraction **nomme les rôles** (`UTILISATEUR :` /
   `AGENT :`) : sans étiquette, le modèle ne peut pas distinguer un enseignement
   de l'utilisateur d'une affirmation de l'agent.

   Deux remparts contre une **boucle de rétroaction** constatée en live le
   22/09/2026 (le souvenir #53 était le duplicata exact de #51) : la capture
   relit les messages du tour, et le tour porte l'injection que ce plugin vient
   d'écrire dans le prompt — l'extraction relisait donc sa propre injection.
   (1) le bloc injecté est **retiré** du texte soumis (`stripMemoryBlock`) ;
   (2) un fait déjà présent dans le compte n'est **pas réécrit** (comparaison
   normalisée). Sans le second, un même fait s'écrit à chaque tour qui le porte.

   La capture est *fail-open* par construction, donc **observable** : chaque
   sortie écrit un état (`hors_connexion`, `desactivee`, `sans_session`,
   `tour_trop_court`, `llm_indisponible`, `rien_a_retenir`, `deja_connu`, `ecrit`, `erreur`) que la route et la carte affichent. Sans
   ça, « rien à retenir » et « le service LLM manque » se ressembleraient
   exactement — c'est le même angle mort que « le panneau est sélectionné » sans
   « le panneau est visible ».

Routes locales (mêmes gardes same-origin et méthode stricte que les autres) :

| Route | Méthode | Rôle |
| --- | --- | --- |
| `/kybernos-cloud/memory` | GET | liste du compte + kybers cloud + correspondance + compteurs de leçons |
| `/kybernos-cloud/memory/add` | POST | ajoute un souvenir (`{content, kind, source?, pinned?}`) |
| `/kybernos-cloud/memory/update` | POST | épingle / détache / change la rétention (`{id, …}`) |
| `/kybernos-cloud/memory/delete` | POST | oublie un souvenir (`{id}`) |
| `/kybernos-cloud/memory/search` | GET | cherche (`?q=`) |
| `/kybernos-cloud/memory/map` | POST | écrit la correspondance kyber local → kyber cloud |
| `/kybernos-cloud/memory/lessons` | POST | pousse les leçons locales (`dryRun` par défaut) |
| `/kybernos-cloud/memory/list` | GET | liste **paginée et filtrée** du compte (`limit`, `offset`, `show`, `src`, `added`, `q`) |
| `/kybernos-cloud/memory/settings` | GET | les interrupteurs `memories`, `context`, `capture` |
| `/kybernos-cloud/memory/settings/set` | POST | pose un ou plusieurs interrupteurs (booléens ; refus en bloc sinon) |

Chaque chemin est **distinct** : le routeur indexe par chemin, donc deux routes
sur `/memory` se masqueraient l'une l'autre (défaut trouvé par la suite host).

### Réglages, origine des écritures, liste paginée

- **Interrupteurs** (`memories`, `context`, `capture`, tous vrais par défaut) : fichier
  `kybernos-cloud-memory.json`, **à côté** de l'état (0600) et pas dedans, car l'état
  disparaît à la déconnexion alors qu'un « Mémoire : non » doit survivre à une
  reconnexion. `context=non` : aucun chunk ; `memories=non` : aucun chunk, outils
  refusés (`memoire_desactivee`), pas de capture ; `capture=non` : la capture ne coûte
  ni appel réseau ni jeton (état `desactivee`). Ces interrupteurs gouvernent **ce
  plugin** : le proxy Kybernos injecte aussi un bloc mémoire pour les requêtes qui
  passent par lui, et ne les connaît pas encore.
- **Origine** : le serveur marque la capture, l'outil d'un agent et la poussée de
  leçons du même `source` (`conversation`). Le plugin note donc localement qui a écrit
  quoi (`kybernos-cloud-memory-origins.json`, 5 000 ids max) : `capture`, `agent`,
  `taught` (la carte), `sync`. Pour un souvenir écrit ailleurs, l'origine est déduite
  de `source` et la liste porte `originKnown: false`.
- **Liste** : `GET /kybernos-cloud/memory/list` calcule sur le cache, car
  `GET /v1/memories` renvoie tout et ne pagine pas encore. Chaque ligne porte `sent`,
  qui vient de la **même** sélection que le prompt : l'écran ne peut pas annoncer autre
  chose que ce que lit le modèle. La recherche est textuelle (`search.mode: exact`,
  `relevance: false`).

### Correspondance des kybers

Les identifiants n'ont rien en commun (locaux : `default`, `dev-team`… ; cloud :
`kg52d53f4ce522`…). La correspondance est donc **explicite et inspectable**
(`state.kyberMap`, éditable depuis la carte), jamais devinée : un kyber local non
relié ne pousse rien, et le rapport de poussée le dit. Les leçons montent en
`scope=kyber`, `kind=policy`, avec **déduplication avant écriture** (un contenu
déjà présent n'est pas réécrit). Les plus récentes passent en premier si le
plafond de 40 coupe.

### Invariants

- hors connexion : aucun chunk, les outils refusent, **aucune requête réseau**,
  et surtout pas le cache du compte précédent (`emptyMemoryCache()`, appelé aussi par
  `disconnect` — un test le vérifie) ;
- une lecture refusée (401) **se dit refusée** — elle ne se déguise jamais en
  « aucun souvenir » (une liste vide et un jeton mort ne se ressemblent pas) ;
- `kyber_id` n'est **pas exposé au modèle** : un modèle ne doit pas pouvoir viser
  le kyber d'un autre (spec serveur §7) ;
- l'injection est fail-open (pas de chunk ⇒ le tour continue), la lecture est
  fail-loud (l'erreur remonte jusqu'à la carte).

## Pourquoi un package séparé

Le half client d'un plugin Cordis doit tenir dans **un seul** `client.js` : le
loader DSH évalue `window.__ModuleLoader__.load({ id, factory })`, il n'y a ni
bundler ni import de fichier voisin. Ce package garde donc l'intégration cloud
isolée du plugin `@local/kybernos` (le plugin local kybers), ce qui évite les
collisions d'écriture et rend chaque moitié livrable indépendamment.

## Comment ça marche (device code flow, RFC 8628)

```
DSH (host)                    api.dev.kybernos.app              navigateur (déjà connecté)
   │ POST /v1/device/start ───────▶│
   │ ◀── device_id, device_secret, user_code, activation_url     │
   │ window.open(activation_url) ───────────────────────────────▶│ /cloud/cli/activate
   │                               │ ◀── POST /v1/device/approve ─┘ (JWT Supabase, fresh-iat)
   │ POST /v1/device/poll (2 s) ──▶│  approved → jeton `kys-…` minté au claim
   │ ◀── { token, user{id,email,name,plan} }        (une seule fois)
   │ GET /v1/me + /v1/workspaces (Bearer kys-…) → profil vivant
```

Le claim ne porte qu'un **instantané** du profil. Chaque rafraîchissement
rappelle donc `GET /v1/me` (nom, formule — la même source que le claim) en plus
de `GET /v1/workspaces` : un nom renseigné ou une montée de formule côté
Kybernos remonte sans ré-appairage. Un serveur plus ancien qui ne connaît pas
`/v1/me` (404) laisse simplement le profil en cache. Si `name` est vide —
c'est le cas aujourd'hui, aucun chemin produit n'écrit `kybernos_users.name` —
la carte affiche la **partie locale de l'email**, grisée et annotée comme un
repli, plutôt qu'un « — » muet. Ce repli est la **décision retenue** (19/09),
pas un provisoire : écrire un vrai nom à la source — onboarding d'inscription
ou écran Profils côté Kybernos — reste une option produit, non planifiée.

Le mot de passe est saisi **dans le navigateur**, sur la page servie par
Kybernos. Ce plugin ne voit jamais ni mot de passe, ni clé Supabase, ni clé
LiteLLM : il ne stocke que le jeton opaque `kys-…`, le même genre de jeton
qu'une session web — révocable depuis l'app Kybernos (**Sécurité → Sessions**,
l'appareil apparaît comme `DSH <nom de la machine>`).

## Invariants de sécurité

1. **Aucun secret dans le dépôt.** L'état vit dans `~/.dsh/kybernos-cloud.json`,
   créé en **0600** (le dossier en 0700). Il est *hors* du dépôt, jamais commité.
2. **Le jeton ne sort pas du half host.** Les routes `/kybernos-cloud/*` ne
   renvoient que `{ user, workspaces, device_label, expires_at }` — jamais le
   jeton, jamais le secret d'appareil. Le half client ne fait que les appeler.
3. **Le secret d'appareil disparaît au claim.** Après le premier poll réussi,
   `device_secret` et `user_code` sont retirés du fichier d'état.
4. **Same-origin.** Les routes mutantes refusent toute origine différente de
   celle de l'hôte (403), comme les autres routes locales des plugins.
5. **Révocation réelle.** « Se déconnecter » appelle `DELETE /v1/session` côté
   serveur (le jeton meurt aussi pour quiconque l'aurait copié), puis efface
   l'état local. Si l'app Kybernos révoque la session, le prochain refresh
   renvoie 401 → la carte affiche « Reconnexion requise ».

## Activation

Le profil DSH web charge les plugins par lien. Ajoutez la dépendance et le
bundle, installez, puis redémarrez DSH (le profil ne se recharge pas à chaud
pour un bundle encore absent) :

```bash
# 1. /Users/<vous>/.dsh/profiles/web/package.json
#    "dependencies": { … , "@local/kybernos-cloud": "link:/chemin/vers/dsh-kybernos/kybernos-cloud" }
#    "dsh": { "profile": { "bundles": [ … , "@local/kybernos-cloud" ] } }

# 2. lien + installation
cd ~/.dsh/profiles/web && pnpm install

# 3. redémarrage de DSH (les bundles sont résolus au démarrage)
```

> **Déjà fait sur ce poste (2026-09-19)** : la dépendance et le bundle sont
> enregistrés dans `~/.dsh/profiles/web/package.json`, le lien
> `node_modules/@local/kybernos-cloud` est en place, et le profil qui sert la
> GUI a rechargé le bundle à chaud (`patchReload: live`) — vérifié par
> `GET http://127.0.0.1:3080/kybernos-cloud/status` → `{"ok":true,…}`.
> Sauvegarde du profil avant modification :
> `~/.dsh/profiles/web/package.json.bak-20260919-avant-cloud`.
> Pour revenir en arrière : restaurer cette sauvegarde, supprimer le lien, et
> `POST /kybernos-cloud/disconnect` avant de retirer l'entrée des bundles.

Variante sans redémarrage : la session qui dispose des outils `cordis_*` peut
définir le plugin à chaud avec le contenu de `index.js` (host) et `client.js`
(client) — même mécanisme que le plugin `kyber-1`.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `KYBERNOS_CLOUD_API` | `https://api.dev.kybernos.app` | base d'API (dev par défaut ; mettez la prod ici) |
| `KYBERNOS_CLOUD_STATE` | `~/.dsh/kybernos-cloud.json` | fichier d'état (tests, profils multiples) |

L'origine de la page d'activation vient du serveur (`activation_url`), donc
rien à configurer côté client.

## Tests

```bash
node scripts/test-cloud.mjs                 # les deux suites d'un coup
node kybernos-cloud/test-cloud-host.mjs     # 46 vérifications, faux Kybernos local
NODE_PATH=<node_modules avec react> node kybernos-cloud/test-cloud-client.mjs   # 3 statiques + rendu
# react/react-dom ne sont pas des dépendances du dépôt : sans eux, la suite
# client se saute proprement. Sinon :
KYBERNOS_CLOUD_REACT_DIR=<node_modules avec react> node scripts/test-cloud.mjs
```

Depuis la mémoire, la suite **client** commence par un étage **statique** qui
tourne même sans react (câblage de la section mémoire + complétude des deux
dictionnaires : 61 clés littérales présentes en fr **et** en). Sans lui,
l'absence de react transformait la suite en « tout vert » silencieux.

La **preuve visuelle** de la mémoire est un script à part :

```bash
node scripts/check-cloud-memory-ui.mjs   # ouvre la carte et MESURE le rendu
```

Il lit l'URL avec token (l'URL nue répond « dsh web authentication required »),
ouvre la carte, vérifie que la section est réellement rendue, que ce que la
carte affiche correspond à ce que le compte contient, que les contrôles sont
dans la carte, et que le libellé du bouton primaire atteint 4,5:1 de contraste
(c'est cette mesure qui a trouvé un libellé blanc sur fond quasi blanc, ratio
1,0 : le CTA « Connecter » était illisible depuis toujours — l'alias
`--dsw-alias-brand-primary` est une couleur de **texte** dans ce thème, pas un
fond). Les deux contrôles qui dépendent de l'âge du half host en mémoire sont
signalés « EN ATTENTE », jamais verts.

Le test host monte les vraies routes sur un faux `webServer` et fait tourner le
cycle complet (start → pending → claimed → profil → révocation), y compris les
cas 401, réseau coupé, origine refusée, méthode invalide, permissions 0600 et
absence de fuite du jeton — plus le cycle catalogue : import au claim (filtre
`kybernos/*`), écriture settings + credential, sync manuel forcé, catalogue
401/illisible, services absents (dégradation), nettoyage à la révocation et à
la déconnexion. Le test client rejoue le contrat
`__ModuleLoader__.load`, vérifie l'enregistrement du slot et le rendu React.

## Dépannage

- **Le bouton n'apparaît pas** → le bundle n'est pas chargé : vérifiez les deux
  entrées dans `package.json` du profil, `pnpm install`, et le redémarrage.
- **« Aucun modèle importé »** → le catalogue n'a pas pu être lu
  (`catalogue_indisponible`, `catalogue_illisible`, `reseau`) : bouton
  « Réimporter » ; si la carte affiche l'avertissement d'import partiel, le
  service `settings` a refusé l'écriture (`settings_refuse`) — regardez le
  journal DSH.
- **Un modèle répond 403** → l'abonnement n'inclut pas sa formule : le gating
  est appliqué par le proxy, à l'appel (fail-closed), pas par DSH.
- **`demarrage_impossible`** → l'API est injoignable ou la variable
  `KYBERNOS_CLOUD_API` pointe sur le mauvais environnement.
- **`trop_de_demandes`** → la limite par IP de `/v1/device/start` (10/min) : les
  demandes en attente expirent au bout de 10 minutes.
- **« Reconnexion requise »** → la session a été révoquée (ou a expiré côté
  serveur, TTL glissant de 30 jours sans appel) : cliquez « Se reconnecter ».
