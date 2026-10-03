# `@local/kybernos-models`

Panneau **Model catalog** en pied de la page native *Settings → Models* : il lit les
modèles réellement configurés dans `settings.yaml`, les préremplit depuis models.dev, et
laisse l'utilisateur surcharger leurs caractéristiques — en écrivant pour de vrai les
champs que le harnais accepte, et **en disant toujours lesquels**.

Le mode d'emploi et les preuves sont dans
[`docs/handoff/model-catalog/README.md`](../docs/handoff/model-catalog/README.md).

## Bloc d'en-tête « Kybernos Models »

Le plugin peint aussi, **avant la rangée `deepseek-official`** de la page native, un bloc
« Kybernos Models » : la marque, le pitch (« curated list of LLMs, automatic fallbacks,
auto-routing — one subscription ») et les puces des modèles `kybernos/*` réellement
importés — ou l'invitation à coupler Kybernos Cloud quand il n'y en a aucun. Il ne lit que
l'état déjà chargé (`KBM`), n'écrit rien et n'invente rien.

Le harnais installé ne déclarait pas ce siège : il est ajouté par
`scripts/patch-dsh-models-header.mjs` (`--check` / `--revert`), **à rejouer après chaque
mise à jour de DSH** — la page native expose alors `settings.models.header`, un siège de
type liste rendu juste avant les rangées.

## Deux niveaux

| Niveau | Champs | Écrit dans |
| --- | --- | --- |
| appliqué au harnais | `name`, `contextWindow`, `maxTokens`, `input`, `reasoningEfforts` (+ `compat`, hors panneau) | le **document settings** du profil, namespace `llm-pi-ai` : `~/.dsh/settings.yaml` jusqu'en 0.1.6, `~/.dsh/profiles/<profil>/cordis.patch.yml` en 0.1.7 (mesuré le 23/09/2026 : `~/.dsh/settings.yaml` est absent, les écritures du panneau arrivent dans le patch) |
| annotation Kybernos | 26 clés (`search`, `s2s`, pricing, type, family, knowledge, release, weights, TTS/image/vidéo, max input…) | `$DSH_HOME/kybernos-models/catalog.json` |

## Contrat host (routes)

Toutes répondent en JSON ; les écritures exigent la même origine (`Origin` égal à `Host`).

| Route | Réponse |
| --- | --- |
| `GET /kybernos-models/status` | `{ok, version, bootedAt, mode, wired[], annotation[], store{}, modelsDev{}}` |
| `GET /kybernos-models/annotations` | `{ok, models:{ 'route/id': {…} }}` |
| `POST /kybernos-models/annotations/save` | `{ok, key, fields, count}` — `{key, fields}` ; clé `route/id` (≤ 300, segments non vides) ; `fields:null` purge la clé ; une valeur `null`/`''` retire le champ |
| `POST /kybernos-models/journal` | `{ok, line}` — une ligne par tentative d'écriture ; `GET …?limit=N` relit les N dernières |
| `GET /kybernos-models/modelsdev?route=&id=&force=1` | `{ok, at, stale, match:{…}|null}` ; `modelsdev-unavailable` si aucun index |

L'index models.dev est mis en cache 6 h dans `$DSH_HOME/kybernos-models/modelsdev.json`,
sous la forme `{ at, data }` (l'ancienne forme, index à la racine, reste lue). Hors ligne,
le cache est servi quand même et la réponse porte `stale: true`.

## Règles d'écriture (namespace `llm-pi-ai`)

- **Route déclarée** (elle porte une liste `models`) : le service **ne traverse pas les
  tableaux** et `path` n'accepte que des chaînes. Le plugin réécrit donc la liste
  `providers.<route>.models` entière, construite depuis la **couche utilisateur**
  (`view.user`) ; jamais depuis la couche résolue, qui matérialiserait les défauts du
  schéma (`input: []`).
- **Route du catalogue** (pas de liste) : `providers.<route>.modelOverrides.<id>.<champ>`.
- **Retirer** une valeur = `{op:'unset', path}` (ou suppression du champ dans la liste
  réécrite) — jamais une réécriture de la valeur de la couche inférieure.
- Liste héritée d'une couche inférieure : refus explicite, jamais de réécriture.
- `reasoningEfforts` n'est écrit que si l'index donne les niveaux ; sinon refus explicite.
- Chaque écriture envoie `KBM.revision` (dernière révision lue) ; `settings/conflict`
  déclenche un rechargement plutôt qu'une seconde écriture.

## Fichiers

| Chemin | Rôle |
| --- | --- |
| `$DSH_HOME/kybernos-models/catalog.json` | annotations locales (`{version, models}`) |
| `$DSH_HOME/kybernos-models/modelsdev.json` | index models.dev, `{at, data}`, TTL 6 h |
| `$DSH_HOME/kybernos-models/journal.ndjson` | 200 dernières tentatives d'écriture |

`$DSH_HOME` est honoré ; à défaut, `~/.dsh`.

## L'écran

Le panneau porte la maquette telle qu'elle a été validée : deux onglets (`Providers` par
défaut, `Model list`), la liste dense avec recherche, quatre `Menu` DSH, huit puces de
capacités, un compteur et `Sync N from models.dev`, la table des modèles et l'éditeur en
**dialogue** que la flèche ouvre. Les hooks `data-kbm` de la ligne ne dépendent pas de
l'onglet : les preuves restent valables.

### Refonte du 21/09/2026 (design)

Le panneau ne vit que dans **deux largeurs réelles**, mesurées : 556 px (la boîte Réglages)
et 720 px (bouton *Full screen*). Les paliers `@container` à 780/900 px étaient du code
mort ; la grille tient sur **un seul palier à 620 px**.

| Avant | Après |
| --- | --- |
| 7 colonnes écrasées dans 556 px : noms coupés (`Claude Sonnet 4.5 (O`), ids coupés (`deepseek/deepseek-v4-l`), SOURCE qui débordait (`5 overrides · 0 applied`) | **5 colonnes** (MODEL · CAPABILITIES · CONTEXT · SOURCE · actions) ; sous 620 px, CAPABILITIES disparaît et les icônes rejoignent la ligne de contexte |
| fournisseur, type et prix dans leurs colonnes, la plupart du temps vides (`—`) | ils composent la **ligne de contexte** du modèle, sous son nom : `id · route · type · prix` — plus aucune colonne vide, plus rien de coupé |
| la surcharge noyée dans SOURCE, en texte (« 5 overrides · 0 applied ») | une **pastille ambre** à côté du nom (`5 overrides`, info-bulle complète) |
| 19 puces de modèles sur 4 rangs | 10 puces + un bouton `+N more` / `Show less` |
| cartes fournisseur : nom + libellé de comptage | + pastille d'initiale, icônes des capacités de la route, compteur, rangées de modèles repliées |
| filtres muets (`Provider · undefined`) | libellé gris + **valeur** ; le déclencheur passe en bleu *business* quand le filtre est actif |

Deux correctifs de fond, invisibles mais bloquants, sont venus avec :

- `Menu` lisait `props.key` — React réserve `key`, il ne le passe jamais en prop : tous les
  filtres écrivaient dans `UI.undefined` et affichaient « · undefined ». La prop s'appelle
  `field`.
- l'ambre du thème s'appelle `--dsw-alias-state-warn-primary`, pas
  `…state-warning-primary` : le jeton inexistant rendait `var()` invalide, donc **aucune**
  affordance ambre (surcharges, valeurs éditées, `Restore defaults` armé) ne se voyait.

Captures de revue (les deux onglets, les deux largeurs) :
`node scripts/shot-model-catalog-refonte.mjs` →
[`9-refonte-liste-556.png`](../docs/handoff/model-catalog/9-refonte-liste-556.png),
[`9-refonte-liste-720.png`](../docs/handoff/model-catalog/9-refonte-liste-720.png),
[`9-refonte-providers-556.png`](../docs/handoff/model-catalog/9-refonte-providers-556.png),
[`9-refonte-providers-720.png`](../docs/handoff/model-catalog/9-refonte-providers-720.png).

L'habillage est **le CSS de DSH** : `scripts/build-model-catalog-css.mjs` écrit les règles
des contrôles extraites de `@deepseek-ai/dsh-client-ui-primitives` dans `dsh-css.js`, et la
même région dans `client.js`, entre les marqueurs `DSH-CONTROLS:BEGIN` / `:END` — la
fabrique d'un client de plugin n'expose que les services injectés, elle ne peut pas importer
un fichier du paquet. Ne pas éditer cette région à la main : `--check` la compare aux
sources installées. Le CSS du panneau, lui, suit juste après (`CSS_PANEL`).

## Mode figé

`?kybernos-models=sample` (ou `&kybernos-models=sample`) monte la maquette d'origine :
4 lignes d'exemple, aucune lecture de `settings.yaml`, aucune écriture possible. C'est le
mode des contrôles de l'étape 1.

## Rafraîchissement (correctif du 23/09/2026)

Le panneau relisait `settings.yaml` **une seule fois**, à sa pose : un fournisseur ou un
modèle ajouté pendant que la page est ouverte restait invisible jusqu'au rechargement de la
page (« j'ai ajouté mimo, mais je ne trouve pas dans Models », constaté deux fois).

Il s'abonne maintenant aux **quatre mêmes invalidations que la page Models native** —
`settings/document-updated`, `credentials/reference-updated`, `llm/adapters-updated` (via
`remote.$on`) et `connection/reset` (événement local) — dans un `ctx.effect` (donc défait au
démontage, anti-rafale compris). Une rafale d'événements donne **une** relecture, 300 ms plus
tard ; une lecture déjà en cours n'est pas doublée, elle est rejouée à sa fin. La relecture
**reprend l'état** des rangées de même clé (`route/id`) : fiche ouverte, fiche models.dev déjà
obtenue, notes de santé, refus à afficher — un conflit de révision, lui, n'est pas ressuscité.

Mesuré le 23/09/2026 sur la GUI ouverte : une écriture `settings/document-updated` faite
**hors** du panneau (taille de texte du thème, via `settings/mutate`) déclenche la relecture
du panneau (2ᵉ puis 3ᵉ lecture des annotations), **sans** perdre l'onglet Models, le filtre
fournisseur ni la fiche ouverte ; la recherche « mimo » rend toujours les 8 modèles.

Limite connue, mesurée le même jour : une édition de `cordis.patch.yml` faite **hors de la
GUI** (agent, éditeur, autre profil) n'émet **aucun** événement — le harnais installé ne
surveille pas ce fichier (`patchReload` n'est lu par aucun paquet). Le panneau reste donc
muet devant une édition externe, comme la page Models native : il faut relancer DSH.

## Contrôles

```bash
node scripts/check-model-catalog-host.mjs                                   # 34 — host seul
node scripts/check-model-catalog-refresh.mjs                                # 34 — câblage du rafraîchissement
node scripts/check-model-catalog-ui.mjs     --url "http://127.0.0.1:3080/" # 45 — écran figé
node scripts/check-model-catalog-browser.mjs --url "http://127.0.0.1:3080/" # 42 — écritures réelles
node scripts/build-model-catalog-css.mjs --check                           # CSS DSH à jour
node scripts/shot-model-catalog-refonte.mjs                                # captures de revue
```

`check-model-catalog-refresh.mjs` ne lit que le bundle : il verrouille les quatre signaux,
l'abonnement dans l'effet, l'anti-rafale et la reprise d'état — **il ne prouve pas** la
relecture en direct (celle-ci demande un navigateur, cf. les mesures du § Rafraîchissement).

**État des suites d'écran au 23/09/2026** (DSH 0.1.7) : elles visent encore
`~/.dsh/settings.yaml`, que 0.1.7 n'écrit plus — `check-model-catalog-browser.mjs` sort en
**64** sans rien mesurer, et `check-model-catalog-ui.mjs` porte **3 échecs préexistants**
(vérifiés identiques sur la baseline git : 7 sections attendues contre 8 réelles depuis
EXTERNAL SCORES, et l'ordre « panneau / add natif »).

Les deux suites d'écran acceptent `--no-shot` (pas de captures) et la suite « navigateur »
accepte `--read-only` (aucune écriture, un contrôle de plus sauté). Le mode figé se demande
par `?kybernos-models=sample` sur l'URL servie, pas par une option du script.

`check-model-catalog-host.mjs` porte **2 échecs connus, antérieurs à cette refonte**
(le cache disque doit être écrit sous la forme `{ at, data }` qu'il relit ensuite) : ils
concernent `index.js`, que cette refonte n'a pas touché.

## Catalogue de fournisseurs « Add provider » (02/10/2026)

Le formulaire d'ajout de fournisseur (onglet Providers) reprend l'ossature du dialogue
natif de DSH — onglets *Catalog provider / Custom API*, Provider, API key, *Advanced
settings* — avec les ~210 fournisseurs de [models.dev](https://github.com/anomalyco/models.dev)
(sections Gratuits · Populaires · Tous, recherche, ↑↓ + Entrée, logos themés).

| Route host | Réponse |
| --- | --- |
| `GET /kybernos-models/providers` | `provider-catalog.json` : `{version, source, providers:[{id, nom, env, url, doc, logo, modele?}]}` |
| `GET /kybernos-models/logo?id=<id>` | SVG nettoyé (`logos/<id>.svg`), 404 sinon ; CSP stricte, cache 24 h |

Les deux sont lues sur disque, aucun appel réseau. Regénérer (après une mise à jour de models.dev) :

```bash
git clone --depth 1 https://github.com/anomalyco/models.dev /tmp/mdv
node scripts/build-provider-catalog.mjs --md /tmp/mdv
```

- Beaucoup de gros fournisseurs (OpenAI, Groq, Mistral…) n'ont pas de champ `api` dans
  models.dev : le script les complète avec leur endpoint compatible OpenAI
  (`FALLBACK_URL`). Les fournisseurs à SDK propriétaire sans endpoint OpenAI (Bedrock,
  Vertex, Azure…) sont écartés ; ceux dont l'URL dépend du compte (`${VAR}`) restent, avec
  l'URL à compléter.
- Les logos sont peints en **masque CSS** (`LogoMd`) : seule la silhouette compte, elle prend
  la couleur du thème. Pas de logo exploitable → initiale.
- La clé collée dans le formulaire part à `remote.credentials.set(<variable>, <clé>)` — le
  même coffre que le flux natif et la carte Kybernos Cloud, jamais `settings.yaml`.
- Sans l'hôte à jour, le client retombe sur la courte liste intégrée (`PROV_CATALOG`).
