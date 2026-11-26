# Verrouillage de la page « Connecteurs » — état réel du code

**Objet** : preuves `fichier:ligne` avant la maquette v1 « tout le catalogue visible, inutilisable sans compte Kybernos ou clé Composio personnelle ».
**Dépôt** : `kybernos-plugins`, HEAD `f3ae9aee` (2026-10-30 20:21 +01:00, arbre propre pour `packages/kybernos-composio/`).
**Lu** : `packages/kybernos-composio/{client.js,index.js,catalog.js}` + la moitié cloud quand le code l'appelle (`packages/kybernos-cloud/{index.js,connections.mjs,connections-host.mjs}`) + les libellés d'incitation existants (`packages/kybernos-plugin/client.js`).
**Méthode** : `grep -n`, `sed -n`, et deux mesures `node -e` en lecture seule sur `catalog.js` (aucun test lancé, aucune capture, aucune modification hors de ce fichier).

---

## TL;DR — les 6 réponses

| # | Question | Réponse courte |
|---|---|---|
| 1 | État sans clé | Le catalogue des **100 apps embarquées est entièrement navigable** ; un bandeau `kb7-nokey` dit « Ajoute ta clé Composio dans Réglages › Connecteurs pour activer les connexions. » ; l'onglet « Tes connexions » est vide ; cliquer « Ajouter une connexion » renvoie le **même message en erreur rouge** (le verrou est à l'action, pas à l'affichage). |
| 2 | « Load the full catalog » | `GET /kybernos-cloud/connections/apps` → catalogue du **serveur Kybernos** (pas Composio directement) ; la liste **remplace** les 100 (elle ne s'y ajoute pas) ; **nombre non écrit dans le code** (commentaires : ~1 559 / ~1 600) ; **logos : seulement pour les apps déjà dans les 100** — les autres ont un **monogramme**, et leur **description est vidée** (`d: ''`). |
| 3 | Logos | `catalog.js` : **100 apps, 98 SVG réels** (en-tête), **394 420 octets mesurés** ; 2 apps des 100 sans SVG (`addresszen`, `airparser`) ; hors des 100 : **monogramme** (initiale majuscule sur pastille grise), pas de logo. |
| 4 | Clé personnelle | **Réglages › Connecteurs** (`settings.section`, label « Connecteurs ») → carte « Composio — ta propre clé » → champ `ck_…` + « Enregistrer » / « Effacer » ; vérification 401/403 → « Composio a refusé cette clé… » ; une note renvoie aussi la page vers ce même endroit. |
| 5 | Compte Kybernos | Bascule de mode dans « Tes connexions » : « Ma clé Composio » / « Connexions Kybernos » ; appels `/kybernos-cloud/{connections,connections/apps,start,poll,connections/link,connections/item,connections/delete}` ; écran « Connecte ton compte Kybernos. » + bouton « Connecter mon compte Kybernos » ; **pas d'écran « créer un compte » dans Connecteurs** (il existe ailleurs : pied de sidebar « Se connecter / Créer un compte » et écran d'onboarding sans modèle « Créer mon compte »). |
| 6 | Compteur total | **Non.** Le seul nombre affiché est la taille de la liste chargée (100 au départ, puis ce que le serveur renvoie) — badge de l'onglet, `total` de la barre, puce « Toutes · N ». Aucun « 1 500 » dans le code ni dans l'UI : seulement `1559` / `1 600` en **commentaires**. |

---

## 0. Le modèle du verrou, en une page

Trois verrous distincts, qui ne parlent pas de la même chose :

- **L1 — pas de clé personnelle** : la page reste utilisable en lecture (catalogue local), l'écriture (connecter une app) échoue. Bandeau bleu-gris `kb7-nokey` + erreur au clic.
- **L2 — clé refusée** : Composio répond 401/403 → bandeau d'erreur rouge `kb.cp.err.401`.
- **L3 — compte Kybernos** : la « seconde porte ». Elle n'existe que si **le serveur Kybernos de la machine offre les connexions** et si **la moitié cloud répond** ; sinon le mode est **totalement caché** (pas de bascule, pas d'invite).

Le mode en vigueur (`personal` | `kybernos`) décide **de l'onglet « Tes connexions » uniquement** : « Découvrir » et « Serveurs MCP » sont les mêmes dans les deux modes.

```
                        ┌──────────────────────────────────────────────┐
Réglages › Connecteurs  │ carte Composio (clé) │ carte Kybernos Cloud │
                        └───────────┬──────────────────┬───────────────┘
                     POST /kybernos/composio/key   GET/POST /kybernos/composio/provider
                                    │                  │
   Page Connecteurs  ── mode = personal ──► clé sur la machine (hôte composio)
                     └─ mode = kybernos ──► token du compte (hôte kybernos-cloud) ──► serveur Kybernos
```

Règle de défaut du mode, pure (`packages/kybernos-composio/client.js:804-808`) :

```js
const kbCpModeEffective = (stored, offered, keyConfigured) => {
  if (offered !== true) return 'personal'
  if (stored === 'kybernos' || stored === 'personal') return stored
  return keyConfigured === false ? 'kybernos' : 'personal'
}
```

→ **sans clé enregistrée ET si Kybernos est offert, le défaut est `kybernos`** : l'onglet « Tes connexions » montre alors l'écran de connexion au compte, pas le bandeau « pas de clé » (`client.js:2708` n'affiche le bandeau que si `kcMode === false`). C'est le point le plus contre-intuitif du verrou actuel, et celui qui décide de la maquette.

---

## 1. Que voit-on / que peut-on faire sans AUCUNE clé Composio ?

### 1.1 Ce qui s'ouvre

- La page s'ouvre sur l'onglet **« Tes connexions »** (`kb.cp.tab.yours` = « Tes connexions », `client.js:219` ; défaut `client.js:2219`), avec trois sous-onglets : « Tes connexions », « Découvrir », « Serveurs MCP » (`client.js:2695-2701`).
- **Le catalogue est là et navigable** : au montage, la page charge le catalogue embarqué de l'hôte (`client.js:2345-2350`, `kbCpCatalog()` `client.js:43-63` → `GET /kybernos/composio/catalog`, route `index.js:68` / `index.js:1968`). Recherche, facettes, tri, pagination, cartes/liste fonctionnent sans clé.
- **Bandeau d'état** (`client.js:2708`, sous la rangée de contrôles) :

```js
(vtab !== 'mcp' && kcMode === false && ready === true && hostCfg === false && Object.keys(conns).length === 0)
  ? h('div', { className: 'kb7-nokey' }, Icon('key', 15), kbt('kb.cp.nokey')) : null
```

  avec `kb.cp.nokey` (`client.js:180`) :

  > FR : « Ajoute ta clé Composio dans Réglages › Connecteurs pour activer les connexions. »
  > EN : « Add your Composio key in Settings › Connectors to enable connections. »

  Les trois conditions viennent de l'hôte : `GET /kybernos/composio/connections?toolkits=…` répond **200** avec `configured:false, error:'no-credential', connections:[]` quand il n'y a pas de clé (`packages/kybernos-composio/index.js:568-576`), et la page en déduit `hostCfg` (`client.js:2318-2338`, initialisé à `null` pour « ne jamais faire clignoter le bandeau », `client.js:2225-2228`).
- **Onglet « Tes connexions » vide** (`client.js:2723-2728`) : illustration au trait (prise), puis

  > `kb.cp.yours.empty` (`client.js:234`) : « Aucune app connectée pour l'instant — le catalogue t'attend. »

  et un bouton qui bascule sur Découvrir : `kb.cp.yours.go` (`client.js:256`) : « Parcourir le catalogue ».

### 1.2 Ce qu'on peut faire (et où ça casse)

- **Les cartes ne sont pas désactivées** : `appCard` (`client.js:2574-2591`) est un `button` sans `disabled` ; le clic ouvre la feuille de l'app (`modal()`, `client.js:2533-2556`).
- Dans la feuille : « Aucun compte connecté pour cette app. » (`kb.cp.noacc`, `client.js:189`) + un bouton primaire **« Ajouter une connexion »** (`kb.cp.addconn`, `client.js:187`, rendu `client.js:2555`) **actif**.
- Au clic : `POST /kybernos/composio/accounts` (`connect`, `client.js:2383`) ; l'hôte répond `409 { ok:false, error:'no-credential', code:'no-credential' }` (`packages/kybernos-composio/index.js:1725`) ; la page substitue le libellé :

```js
setErr(r.status === 404 && r.json === null ? kbt('kb.cp.hostold') : (code === 'no-credential' ? kbt('kb.cp.nokey') : kbCpErrText(code)))  // client.js:2391
```

  → **le même texte que le bandeau, mais en erreur rouge** (`role="alert"`, `client.js:2709`). Rien n'est grisé, rien ne renvoie vers Réglages par un bouton : le message est un texte mort.
- Avec une clé **présente mais refusée**, le bandeau devient l'erreur 401 (`kb.cp.err.401`, `client.js:266`, mappage `client.js:623`, affichage `client.js:2391` / `client.js:2709`) :

  > « Composio a refusé la clé API (401). Vérifie-la dans le panneau de la clé. »

  (le « panneau de la clé » = la carte de Réglages › Connecteurs, cf. §4.)
- Si le plugin hôte est plus ancien que la page (404 sans corps) : `kb.cp.hostold` (`client.js:286`) — « le plugin hôte tourne encore dans sa version précédente… la liste est en lecture seule. »
- Si **Kybernos est offert** : `kcMode` passe à `true` dès le premier rendu (défaut `kybernos`, §0) → **le bandeau « pas de clé » disparaît** et « Tes connexions » affiche l'écran « Connecte ton compte Kybernos. » (§5).

### 1.3 Bandeaux / boutons : inventaire exact

| Élément | Classe / `data-kb` | Libellé FR (clé i18n → ligne `client.js`) |
|---|---|---|
| Bandeau « pas de clé » | `.kb7-nokey` (`client.js:2708`) | « Ajoute ta clé Composio dans Réglages › Connecteurs pour activer les connexions. » (`kb.cp.nokey`, 180) |
| Erreur en rouge | `.kbcp-err[role=alert]` (`client.js:2709`) | 401 : « Composio a refusé la clé API (401). Vérifie-la dans le panneau de la clé. » (`kb.cp.err.401`, 266) |
| Onglet | `[data-kb=subtab-yours]` | « Tes connexions » (`kb.cp.tab.yours`, 219) |
| Onglet | `[data-kb=subtab-discover]` | « Découvrir » (`kb.cp.tab.discover`, 220) |
| Onglet | `[data-kb=subtab-mcp]` | « Serveurs MCP » (`kb.cp.tab.mcp`, 296) |
| Bouton (feuille app) | primaire | « Ajouter une connexion » (`kb.cp.addconn`, 187) |
| Bouton (Yours vide) | secondaire | « Parcourir le catalogue » (`kb.cp.yours.go`, 256) |
| Aide animée (1ʳᵉ visite) | `window.__KB_HELP__.Intro` (`client.js:2651-2659`) | « Connecter une app en trois étapes » (`kb.cp.intro.title`, 221) dont l'étape 1 dit : « Dans Découvrir, choisis une app et clique « Ajouter une connexion ». **Il faut ta clé Composio ou ton compte Kybernos.** » (`kb.cp.intro.s1b`, 224) |

---

## 2. Ce que fait exactement « Charger le catalogue complet » (`kb.cp.loadall`)

### 2.1 Quand le bouton existe

Rendu à deux endroits (barre de contrôles `client.js:2745-2746` ; repli sans barre unifiée `client.js:2705`), toujours avec la **même condition** :

```js
apps.length <= CATALOG.length ? h('button', { ..., onClick: loadAll }, loadingAll ? kbt('kb.cp.loading') : kbt('kb.cp.loadall')) : null   // client.js:2746
```

→ visible **uniquement dans « Découvrir »** et **tant que la liste affichée fait ≤ 100** ; après un chargement réussi elle disparaît (un rechargement de page ramène à 100, l'état initial étant `CATALOG`, `client.js:2194`).
Libellés : `kb.cp.loadall` « Charger le catalogue complet » / « Load the full catalog » (`client.js:190`) ; pendant l'appel `kb.cp.loading` « Chargement… » (`client.js:191`).

### 2.2 L'appel (le code, ligne à ligne)

```js
const loadAll = async () => {                                    // client.js:2362
  setLoadingAll(true); setErr(null)
  try {
    const r = await kbCpCloud('/connections/apps')                // client.js:2366
    const j = r.json
    const list = r.status === 200 && j !== null && j.ok === true && Array.isArray(j.apps) ? j.apps : []
    if (list.length === 0) throw new Error(j !== null && j.connected === false ? 'sign in to Kybernos Cloud first' : (j !== null && j.offered === false ? 'this server offers no catalog' : 'empty catalog'))   // client.js:2369
    const merged = list.filter((a) => a !== null && typeof a === 'object' && typeof a.slug === 'string' && a.slug.length > 0)
      .map((a) => ({ s: a.slug, n: String(a.name || a.slug), c: Array.isArray(a.categories) ? a.categories.filter((x) => typeof x === 'string') : [], d: '', l: logoOf(a.slug) }))   // client.js:2373
    setApps(merged)                                               // client.js:2374
    setReady(true)
    refresh(merged)                                               // client.js:2376
  } catch (e) { setErr(kbt('kb.cp.err.fullcatalog') + ': ' + String((e && e.message) || e)) }   // client.js:2378
  finally { setLoadingAll(false) }
}
```

Chaîne complète de l'appel :

1. `kbCpCloud` = `fetch('/kybernos-cloud' + path)` (`client.js:781`, `client.js:789-798`).
2. Route locale `GET /kybernos-cloud/connections/apps` (`packages/kybernos-cloud/index.js:5968`).
3. Moitié cloud : `connections.appsRoute` (`packages/kybernos-cloud/connections-host.mjs:80-87`).
4. Serveur : `GET /v1/connections/apps` (`packages/kybernos-cloud/connections.mjs:15`), sur le **projet Composio du serveur Kybernos** (en-tête de `connections.mjs:1-3` : « the apps a person connects once … through the server's own Composio Platform project »).

**Ce n'est donc pas un appel Composio depuis le navigateur** : c'est le catalogue du serveur Kybernos auquel la machine est connectée. C'est pour ça que le bouton **exige un compte** : sans `isConnected`, la moitié cloud répond `{ ok:false, offered:true, connected:false, error:'non connecte' }` (`connections-host.mjs:50-52`) et le client lève `sign in to Kybernos Cloud first`.

### 2.3 Combien d'apps en plus ?

**INTROUVABLE dans le code comme constantes** : le nombre est celui que renvoie le serveur, il n'est ni borné ni compté côté page. Ce que le dépôt documente (commentaires, jamais affiché) :

- `packages/kybernos-composio/index.js:145` : « The PUBLIC catalog (proxy, about 1559 apps) comes first; when the network fails, the local catalog (100 apps, key "s") stands in. »
- `packages/kybernos-composio/index.js:194` : « Account scan: about 1559 slugs in batches (measured: 4 batches of 400 in 3.5 s). »
- `packages/kybernos-composio/client.js:915-921` : « about 120 of 1,600 » apps connect in one click (sign-in géré par le serveur).

Ordre de grandeur : **~1 500 de plus** (100 → ~1 559/1 600), mais c'est une valeur de commentaire, **pas** une valeur du produit.

### 2.4 Où sont les données — et ce qu'elles contiennent

Le serveur n'envoie **pas de logo** et sa description est tronquée ; le client **jette** même la description. Contrat côté cloud (`packages/kybernos-cloud/connections.mjs:111-121`) :

```js
export const asApp = (r) => { … return { slug, name, categories: … .slice(0, 8), description: … .slice(0, 400), needsApiKey: row.needs_api_key === true } }
```

Puis le client mappe (`client.js:2373`) : `s` slug, `n` nom, `c` catégories, **`d: ''`** (donc carte **sans description**), **`l: logoOf(a.slug)`**.

### 2.5 Les apps chargées ont-elles un logo ? — **Non, sauf recoupement avec les 100**

`logoOf` ne lit que le catalogue embarqué (`client.js:162` : `const logoOf = (slug) => { const c = catOf(slug); return c ? c.l : null }`, avec `CAT_BY_SLUG` construit à la réception des 100, `client.js:36` + `client.js:58-61`).

- App **présente dans les 100** → son SVG s'affiche normalement (même après Load-all).
- App **hors des 100** (la grande majorité, ~1 400+) → `l: null` → `AppLogo` (`client.js:947-961`) tombe sur un **monogramme** : initiale majuscule du nom sur pastille arrondie, fond `rgba(128,128,128,.18)` (sauf table spéciale `APP_TILES`, qui ne contient que `cal`, `client.js:944-946`).

  ```js
  const t = APP_TILES[slug] || { bg: 'rgba(128,128,128,.18)', color: 'inherit' }
  … String(nameOf(slug) || '?').charAt(0).toUpperCase()   // client.js:956-960
  ```

Conséquence pour la maquette : après « Load the full catalog », **la grille change d'aspect** — la plupart des cartes passent d'un logo SVG sur fond blanc à une **lettre grise**, et perdent leur description.

### 2.6 Échecs visibles

| Cas | Message affiché |
|---|---|
| Pas connecté au compte Kybernos | `kb.cp.err.fullcatalog` « Catalogue complet indisponible » + `: sign in to Kybernos Cloud first` (**l'erreur anglaise fuit dans une UI française**, `client.js:2369` + `client.js:2378`) |
| Serveur sans catalogue | « Catalogue complet indisponible : this server offers no catalog » |
| Liste vide | « Catalogue complet indisponible : empty catalog » |
| Cloud absent (status 0) | `list.length === 0` → « …: empty catalog » (même branche) |

Le libellé du bandeau d'erreur : `kb.cp.err.fullcatalog` (`client.js:258`) « Catalogue complet indisponible » / « Full catalog unavailable », dans `.kbcp-err[role=alert]` (`client.js:2709`).

---

## 3. Où vivent les logos aujourd'hui

### 3.1 Le fichier embarqué

En-tête de `packages/kybernos-composio/catalog.js:1-7`, verbatim :

> `// Embedded Composio catalog, generated from the Kybernos cloud repo`
> `// (apps/app/src/components/landing/integrations-catalog.json + integrations-logos-live.ts).`
> **`// 100 apps, 98 real SVG logos (357 KB).`**
> `// The Composio MCP exposes NO catalog (resources/list -> -32601, search returns 4-6 tools`
> `// per request): this local list is the only source for the display.`
> `// SVGs are normalized: width/height removed (the container sizes them), ids prefixed`
> `// lgb-<slug>- (collision guard), mangled markup repaired and every logo checked`
> `// (scripts/svg-check.mjs). Regenerate: KYBERNOS_REPO=<checkout> node scripts/build-catalog.mjs`

Mesures faites sur le fichier (lecture seule) :

| Mesure | Valeur | Source |
|---|---|---|
| Taille du fichier | **394 420 octets** | `stat` |
| Entrées | **100** | parse du littéral |
| Entrées avec SVG réel (`l` commence par `<svg`) | **98** | parse du littéral |
| Entrées **sans** SVG (`l: null`) | **2** : `addresszen`, `airparser` | parse du littéral |
| Champs par app | `s` slug, `n` nom, `c` catégories, `d` description, `l` SVG ou `null` | parse du littéral |
| Poids moyen d'un logo | ≈ 3 727 octets | parse du littéral |
| Tout le catalogue est sur **une seule ligne** | ligne `catalog.js:7` (`export const CATALOG = [{…},…]`) | `sed` |

Deux chiffres de taille contradictoires dans le dépôt (à ne pas recopier en maquette) : `catalog.js:3` dit **357 KB** et `index.js:8` dit **412 KB** ; le fichier réel fait **394 420 octets** (≈ 385 KiB).

### 3.2 Comment le logo arrive à l'écran

1. L'hôte lit `catalog.js` **une fois**, garde le corps en mémoire et le sert tel quel sur `GET /kybernos/composio/catalog` (`index.js:67-70`, `index.js:127-140`, `index.js:1968`), avec `ETag` + `cache-control: public, max-age=3600` (`index.js:69`, `index.js:252-268`). Commentaire d'en-tête : « catalog.js stays the source of truth on disk » (`index.js:9`).
2. Le client télécharge une fois et garde `CATALOG` + `CAT_BY_SLUG` en mémoire (`client.js:31-63`).
3. `AppLogo(slug, taille)` (`client.js:947-961`) : SVG réel → conteneur `.kb7-applogo` blanc bordé, SVG injecté en `dangerouslySetInnerHTML` (dimensionné à 74 % par la règle CSS `client.js:1028`).
4. Utilisations : cartes et lignes d'app (`client.js:2578`, `client.js:2622`), feuille d'app (`client.js:2541`), fenêtre « Connecter une app » côté Kybernos (`client.js:1938`), lignes de connexions de Réglages (`client.js:3150`), cartes de ressource du chat (`carteIcon`, `client.js:2796-2801`).

### 3.3 Une app hors des 100 : que voit-on ?

**Un monogramme, jamais rien.** Ordre exact dans `AppLogo` : SVG → sinon `APP_TILES[slug]` → sinon pastille grise générique + **première lettre du nom en majuscule** (`client.js:956-960`). Il n'y a ni logo réseau, ni fetch d'image, ni champ « logo » dans le contrat serveur (`connections.mjs:111-121`) : **INTROUVABLE** — aucune source de logo pour les apps hors des 100.

Détail visuel à reprendre en maquette : le SVG est dans une pastille **blanche bordée** (`background:'#fff'`, `border:'1px solid rgba(128,128,128,.18)'`, `client.js:949-954`), alors que le monogramme n'a **ni fond blanc ni bordure** (fond gris translucide). Sur 1 500 cartes, cette différence est le signal visuel dominant.

⚠️ Le commentaire `client.js:941-943` dit : « Tile colours for an app with no logo. **Only `cal` can reach it** » — c'est **faux après Load-all** : c'est vrai seulement du catalogue de 100 (les 2 sans SVG sont `addresszen` et `airparser`, absentes de `APP_TILES`, donc déjà en gris générique). Toute app chargée hors des 100 atteint cette branche.

---

## 4. Chemin « j'apporte ma propre clé »

### 4.1 Où ça se saisit

**Réglages › Connecteurs**, pas la page Connecteurs. La section est enregistrée dans le slot `settings.section` (`client.js:3241-3244`) :

```js
slots.inject('settings.section', () => slots.register(
  { name: 'settings.section', id: 'kybernos-composio', order: 30, label: () => kbt('kb.cp.set.nav') }, …
```

- libellé de navigation : `kb.cp.set.nav` = « Connecteurs » (`client.js:237`)
- titre de page : `kb.cp.set.h1` = « Connecteurs » (`client.js:238`)
- chapeau : `kb.cp.pv.lead` (`client.js:479`) : « Quel service relie tes apps (Gmail, Slack, Notion…) pour tes agents. Un seul à la fois : tes agents voient celui que tu choisis ici. »
- la même carte de clé est aussi montée dans la page Plugins, sous le bundle (`slots.inject('plugins.bundle.config', …)`, `client.js:3234-3235`).

La page est composée de **deux cartes « fournisseur »** (`ComposioSettingsPage`, `client.js:3075`) : `composioCard()` (`client.js:3157-3171`) et `kybernosCard()` (`client.js:3191-3197`), plus un pied et la liste des connexions.

### 4.2 Libellés exacts de la carte « clé »

| Élément | Clé i18n → ligne `client.js` | FR verbatim |
|---|---|---|
| Nom du fournisseur | `kb.cp.pv.composio` (480) | « Composio — ta propre clé » |
| Pastille | `kb.cp.pv.you` (482) | « Tu le gères » |
| Sous-titre | `kb.cp.pv.composio.sub` (481) | « Tu apportes ta clé Composio. Tes comptes vivent dans ton projet Composio ; la clé reste sur cet ordinateur. » |
| Titre du bloc de saisie | `composio.keylabel` (168) | « Clé Composio » |
| Note | `composio.keynote` (169) | « Ta clé personnelle Composio : elle pilote cet onglet ET les agents du chat. Elle reste sur cette machine ; les outils sont appelés chez Composio. » |
| Champ | `client.js:1346` | `type=password`, placeholder `ck_…`, `aria-label` « Clé Composio » |
| Bouton primaire | `composio.keysave` (166) | « Enregistrer » |
| Bouton secondaire | `composio.keyclear` (167) | « Effacer » (seulement si une clé est enregistrée, `client.js:1348`) |
| Aide dépliable | `composio.keyhelpq` (170) | « Comment trouver ma clé Composio ? » — 3 étapes (171-173), dont « Ouvre dashboard.composio.dev et connecte-toi (**compte gratuit**). » et « Colle la clé (elle commence par `ck_…`) ci-dessus ». |
| État sous la carte | `kb.cp.set.key.on` / `.off` (241-242) | « Configurée » / « Non configurée » |
| Source de la clé | `kb.cp.set.key.src.env` / `.setting` / `.none` (243-245) | « fournie par l'environnement » / « enregistrée ici » / « source inconnue » |

États internes affichés en lignes à pastille (`client.js:1330-1336`, rendu `client.js:1339-1349`) :

| Clé | FR verbatim |
|---|---|
| `composio.keyunset` | « Aucune clé enregistrée » |
| `composio.keyset` | « Clé enregistrée sur cette machine » |
| `composio.keyenv` | « Clé fournie par l'environnement de lancement de DSH (à changer là-bas) » |
| `composio.accepted` | « Composio l'accepte » |
| `composio.rejected` | « Composio refuse cette clé » |
| `composio.unchecked` | « Composio ne répond pas bien : clé non vérifiée » |
| `composio.agentsSame` | « Les agents du chat l'utilisent » |
| `composio.agentsLater` | « Les agents du chat l'utiliseront après un redémarrage de DSH » |
| `composio.hostunknown` | « État de la clé inconnu : le plugin hôte ne répond pas. S'il vient d'être mis à jour, redémarre DSH. » |

### 4.3 Appels et états d'erreur

- Sauvegarde : `POST /kybernos/composio/key` (`client.js:1300-1316` ; route `index.js:1621` + `index.js:1667`), vérification par Composio, réponse `{ ok, verified, needRestart, code }`.
- Succès (`client.js:1309`) : `composio.savedlive` « Clé enregistrée. » ; `composio.saved` « Clé enregistrée. Les agents l'utiliseront après un redémarrage de DSH. » ; `composio.savedunchecked` « Clé enregistrée, mais Composio ne répond pas : elle n'a pas pu être vérifiée. »
- Erreurs (`client.js:1314`, libellés 288-291) :

| Code hôte | Clé i18n | FR verbatim |
|---|---|---|
| `invalid-key` | `composio.err.invalid` | « Une clé Composio commence par `ck_` et ne contient pas d'espace. » |
| `401` / `403` | `composio.err.rejected` | « Composio a refusé cette clé : elle n'a pas été enregistrée. » |
| `inherited` | `composio.err.inherited` | « La clé vient de l'environnement de lancement de DSH : change-la là-bas. » |
| autre | `composio.err.write` | « La clé n'a pas pu être enregistrée. » |

- Clé fournie par l'environnement : champ **verrouillé** (`const locked = … state.env === true`, `client.js:1337` ; `disabled` `client.js:1346`) et « Effacer » refusé avec `composio.err.inherited` (`client.js:1322`).
- Clé venue de l'ancienne version navigateur : bandeau de migration `composio.migrate` (« Une clé de l'ancienne version est dans ce navigateur. L'enregistrer sur cette machine ? ») + bouton « Enregistrer » (`client.js:1343`).

### 4.4 Le retour vers la page Connecteurs

Le bandeau de la page Connecteurs renvoie **par le texte** à « Réglages › Connecteurs » (`client.js:180`) ; il n'y a **aucun bouton** dans le bandeau. Le seul chemin inverse est dans Réglages, à la fin de la page : `kb.cp.set.open` = « Ouvrir Connectors » (`client.js:3209`, action `openPage` qui émet `kb-open-resources` avec `{ tab: 'composio' }`, `client.js:3139`).

---

## 5. Chemin « compte Kybernos »

### 5.1 Conditions d'existence (sinon : rien)

Le mode n'apparaît que si la moitié cloud répond **dans la bonne forme** : `kbCpCloudView` renvoie `null` hors `{ ok:boolean, offered:boolean }` et le mode est alors **caché** (`client.js:816-839`, commentaire `client.js:810-812` : « A server that does not offer the feature, or a cloud half that is older than this page, answers nothing usable: the mode stays hidden »). La bascule n'est rendue que si `kc.offered === true` (`client.js:2712`).

Côté serveur (`packages/kybernos-cloud/connections-host.mjs:50-52`) :

```js
if (endpoint === null) return { done: { ok: true, offered: false, connected: isConnected(readState()) } }
if (isConnected(state) !== true) return { done: { ok: false, offered: true, connected: false, error: 'non connecte' }, offered: true }
```

→ **offert mais pas connecté** = `offered:true, connected:false` : le mode **est** proposé, et l'écran de connexion s'affiche.

### 5.2 La bascule de mode (onglet « Tes connexions »)

`client.js:2712-2716` — deux boutons + une phrase d'aide :

| Élément | Clé i18n → ligne | FR verbatim |
|---|---|---|
| Libellé du groupe | `kb.cp.kc.mode.label` (390) | « Mode » |
| Bouton 1 (`data-kb=mode-personal`) | `kb.cp.kc.mode.personal` (391) | « Ma clé Composio » |
| Bouton 2 (`data-kb=mode-kybernos`) | `kb.cp.kc.mode.kybernos` (392) | « Connexions Kybernos » |
| Aide mode perso | `kb.cp.kc.mode.hint.personal` (393) | « Tes comptes Composio, avec ta propre clé, sur cette machine. » |
| Aide mode Kybernos | `kb.cp.kc.mode.hint.kybernos` (394) | « Tes apps reliées à ton compte Kybernos : tous tes agents les utilisent, sans clé sur cette machine. » |

Le choix est mémorisé en navigateur (`localStorage['kbcp.mode']`, `client.js:782`, `client.js:811`) **et** poussé à l'hôte par `POST /kybernos/composio/provider` (`client.js:2258`, route `index.js:1896`) ; c'est ce que Réglages relit. Au chargement, **ce que Réglages a choisi gagne** sur le navigateur (`client.js:2266-2271`).

### 5.3 Les appels (page Connecteurs, mode Kybernos)

| Action | Appel | Où |
|---|---|---|
| Lire les connexions + quota | `GET /kybernos-cloud/connections` | `client.js:2252`, `client.js:3100` |
| Catalogue du serveur (liste + fenêtre d'ajout) | `GET /kybernos-cloud/connections/apps` | `client.js:1982`, `client.js:2366` |
| Démarrer la connexion du compte (appairage) | `POST /kybernos-cloud/start` | `client.js:2022-2035` |
| Attendre l'accord (toutes les 3 s) | `POST /kybernos-cloud/poll` | `client.js:2013-2020` |
| Lier une app | `POST /kybernos-cloud/connections/link` | `client.js:1913`, `client.js:2069` |
| Rafraîchir une connexion en attente (5 s, 10 min max) | `GET /kybernos-cloud/connections/item?id=` | `client.js:1998`, constantes `client.js:784-785` |
| Retirer une connexion | `POST /kybernos-cloud/connections/delete` | `client.js:2049` |

Routes : `packages/kybernos-cloud/index.js:5967-5971`. C'est la moitié cloud qui détient le token et appelle le serveur (`/v1/connections*`, `connections.mjs:9-18`) — la page ne voit jamais de token.

### 5.4 L'écran de connexion au compte (incitation existante)

Quand `kc.connected === false` (`client.js:2113-2121`) :

> Titre : `kb.cp.kc.signin.title` (447) = « Connecte ton compte Kybernos. »
> Corps : `kb.cp.kc.signin.body` (448) = « Tes apps sont reliées à ton compte, pas à cette machine : une fois connectées, tous tes agents les utilisent, ici comme ailleurs. »
> Bouton primaire : `kb.cp.kc.signin.go` (449) = « **Connecter mon compte Kybernos** »
> En attente : `kb.cp.kc.signin.wait` (450) = « En attente de ton accord dans l'onglet ouvert… », code `kb.cp.kc.signin.code` (451) = « Code : {code} », lien `kb.cp.kc.signin.open` (452) = « Ouvrir la page ».
> Échec : `kb.cp.kc.err.signin_failed` (453) = « La connexion du compte n'a pas abouti : réessaie. »

Le flux ouvre `pairing.activation_url` dans un onglet (`client.js:2029-2031`) puis scrute `/poll`.

Dans Réglages › Connecteurs, la carte « Kybernos Cloud » (`client.js:3191-3197`) montre :

| État | Clé i18n → ligne | FR verbatim |
|---|---|---|
| Nom | `kb.cp.pv.kybernos` (483) | « Kybernos Cloud » |
| Pastille hors offre | `kb.cp.pv.paid` (485) | « Offres payantes » |
| Pastille dans l'offre | `kb.cp.pv.included` (486) | « Inclus dans ton offre » |
| Sous-titre | `kb.cp.pv.kybernos.sub` (484) | « Les connexions sont gérées par ton compte Kybernos : pas de clé à gérer, et tes comptes te suivent d'un appareil à l'autre. » |
| Pas connecté | bouton `kb.cp.pv.signin` (487) | « Se connecter à Kybernos » + état `kb.cp.pv.signedout` (488) « Pas connecté » |
| Pas dans l'offre | `kb.cp.pv.notplan` (489) | « Non inclus dans ton offre » + bouton `kb.cp.pv.plans` (490) « Voir les offres » |
| Serveur qui n'offre pas | `kb.cp.pv.notoffered` (491) | « Ce serveur Kybernos ne la propose pas encore. » |
| Connecté | `kb.cp.pv.connected` / `.connectedOf` (492-493) | « Connecté · {n} app(s) » / « Connecté · {n} sur {limit} apps » |
| Pied de page | `kb.cp.pv.foot` (495) | « Changer de service ne supprime rien et ne déconnecte rien chez l'autre… » |

### 5.5 Le paywall dans le mode Kybernos

`kc.entitled === false` → `locked` (`client.js:2124`) : le compteur devient `kb.cp.kc.pro.title` (400) « Inclus dans les formules payantes », la liste reste visible, le bouton « Connecter une app » est **désactivé** (`client.js:2135`), et un encart propose `kb.cp.kc.pro.cta` (402) « Voir les formules » (ouvre `kc.web`, `client.js:2138`). Corps : `kb.cp.kc.pro.body` (401) :

> « Les connexions Kybernos font partie des formules payantes : tes apps sont reliées une fois à ton compte et tous tes agents les utilisent. Ta propre clé Composio reste utilisable gratuitement dans l'autre mode. »

Erreur d'ajout hors offre : `kb.cp.kc.err.not_in_plan` (457) « Ta formule n'inclut pas les connexions Kybernos. » (mappage `client.js:910`).

### 5.6 Y a-t-il déjà un écran d'incitation à CRÉER un compte ?

- **Dans la page Connecteurs : INTROUVABLE.** Aucune chaîne « créer un compte / sign up / inscription » dans `packages/kybernos-composio/{client.js,index.js,help.json}`. On y trouve uniquement : se **connecter** (`kb.cp.kc.signin.go`, `kb.cp.pv.signin`), et **payer** (`kb.cp.kc.pro.cta`, `kb.cp.pv.plans`).
- **Ailleurs dans la GUI, oui** — deux surfaces réutilisables pour la maquette :
  - pied de la barre latérale du bundle cloud : `footSignInUp` = « Se connecter / Créer un compte » et `menuSignup` = « Créer un compte » (`packages/kybernos-cloud/client.js:230-232`, rendu du menu `packages/kybernos-cloud/client.js:2589`, ouverture `signupUrl + '/account'`) ;
  - l'onboarding « sans modèle » du bundle cœur : titre `nomodel.t` « Sans modèle, Kybernos ne peut pas répondre », sous-titre `nomodel.s` « Il lui faut un compte Kybernos ou ta propre clé. », deux boutons `nomodel.acct` « Créer mon compte » et `nomodel.key` « Utiliser ma propre clé » (`packages/kybernos-plugin/client.js:39832-39835`, écran rendu `packages/kybernos-plugin/client.js:41946-41951`).
  - C'est **exactement la mise en page à deux portes** que la maquette v1 veut reproduire ; elle existe déjà, mais **pas branchée sur le verrou des Connecteurs**.

---

## 6. Le nombre total d'apps est-il affiché quelque part ?

**Non.** Aucun texte, aucun compteur ne dit « 1 500 apps » / « 1 559 apps » / « plus de 1 500 ». Ce qui est affiché, c'est **la taille de la liste chargée à cet instant** :

| Endroit | Ce qui est compté | Preuve |
|---|---|---|
| Badge de l'onglet « Découvrir » | `apps.length` (100 avant Load-all, N après) | `client.js:2699` |
| `total` de la barre unifiée en Découvrir | `apps.length` | `client.js:2683` |
| Puce « Toutes · N » (repli sans barre) | `apps.length` | `client.js:2742` |
| Pagination | `cur + ' / ' + pages` (pages = liste / 24) | `client.js:2757` (constante `PAGE = 24`, `client.js:2160`) |
| Réglages › Connecteurs | nb d'apps **connectées** (`kc.count`, `kc.limit`), pas le catalogue | `client.js:3189`, clés 492-493 |

Les seules occurrences d'un total sont des **commentaires** (`1559` : `packages/kybernos-composio/index.js:145` et `:194` ; `1 600` : `client.js:921`), jamais rendues. **INTROUVABLE** : une constante ou une chaîne « 1 500 »/« 1500 » dans `client.js`, `index.js` ou `catalog.js`.

Donc, pour la maquette : afficher « +1 500 apps » est **une nouveauté assumée**, pas une reprise de l'existant — et le chiffre ne peut pas venir du code (il vient d'un commentaire obsolète par nature). La seule valeur exacte que le produit connaît est celle que le serveur renvoie quand on clique « Charger le catalogue complet ».

---

## 7. INTROUVABLE (ce que le code ne dit pas)

- **INTROUVABLE: un nombre exact d'apps du catalogue complet** — aucune constante ; le serveur décide, la page affiche `list.length`.
- **INTROUVABLE: le littéral « 1 500 » / « 1500 »** dans les trois fichiers (testé en grep) ; seuls `1559` et `1 600` en commentaires.
- **INTROUVABLE: une source de logo pour une app hors des 100** — pas de champ logo dans `asApp` (`connections.mjs:111-121`), pas de fetch d'image, `logoOf` ne lit que le catalogue embarqué.
- **INTROUVABLE: une description pour les apps chargées** — le client force `d: ''` (`client.js:2373`) alors que le serveur en envoie une (≤ 400 car., `connections.mjs:118`).
- **INTROUVABLE: un écran « créer un compte » dans le parcours Connecteurs** — uniquement « se connecter » et « voir les formules » ; l'incitation existe ailleurs (§5.6).
- **INTROUVABLE: un libellé qui nomme le verrou « abonnement » dans la page Connecteurs** — le paywall n'apparaît que dans le mode Kybernos quand le serveur dit `entitled:false`.

---

## 8. Écarts et pièges constatés (mesurés, à trancher avant la maquette)

1. **Le verrou est à l'action, pas à l'affichage.** Sans clé, les 100 cartes sont cliquables, la feuille s'ouvre, le bouton « Ajouter une connexion » est **actif** : l'échec arrive après le clic, en texte rouge réutilisant le libellé du bandeau (`client.js:2555` → `client.js:2391`). La maquette « visible mais inutilisable » doit décider si elle **grise** les cartes (ce que le code ne fait pas) ou si elle **garde le clic** et transforme l'erreur en invitation.
2. **Le bandeau « pas de clé » disparaît en mode Kybernos** (`client.js:2708` : `kcMode === false`). Sur une machine où Kybernos est offert, un utilisateur sans clé ne voit **jamais** le message « Ajoute ta clé… » : il voit l'écran de connexion au compte. Deux publics, deux messages, à ne pas mélanger dans la maquette.
3. **Load-all n'ajoute pas, il remplace** (`setApps`, `client.js:2374`) et **casse l'aspect** : descriptions vidées (`d:''`) + majorité de monogrammes gris (§2.4-2.5). Une maquette qui montre 1 500 logos colorés contredit le code.
4. **Le code fuit de l'anglais dans l'UI française** : « Catalogue complet indisponible : **sign in to Kybernos Cloud first** » (`client.js:2369` + `client.js:2378`).
5. **Commentaire périmé** `client.js:941-943` (« Only `cal` can reach it ») : faux dès que le catalogue complet est chargé.
6. **Tailles contradictoires** : `catalog.js:3` = « 357 KB », `index.js:8` = « 412 KB », réel = **394 420 octets**.
7. **2 des 100 apps n'ont pas de SVG** (`addresszen`, `airparser`) : même le catalogue embarqué n'est pas homogène à 100 logos.
8. **Le bouton « Load the full catalog » disparaît une fois chargé** (`apps.length <= CATALOG.length`) et **revient à 100 au rechargement de page** (état initial `CATALOG`, `client.js:2194`) : pas de persistance du « catalogue complet ».
9. **Deux verrous tarifaires distincts, à ne pas confondre** : mode Kybernos `entitled:false` → « Inclus dans les formules payantes » ; limite atteinte → « Limite atteinte ({limit} sur {limit}) : retire une connexion pour en ajouter. Le maximum dépend de ton offre. » (`kb.cp.kc.full`, 399). Ne pas les confondre avec le verrou « pas de compte ».

---

## 9. Repères de preuve (reproductibles, lecture seule)

```
grep -n "kb\.cp\.nokey\|kb\.cp\.err\.401\|kb\.cp\.loadall" packages/kybernos-composio/client.js
sed -n '2362,2380p;2700,2760p' packages/kybernos-composio/client.js
sed -n '60,150p;560,600p;1660,1740p' packages/kybernos-composio/index.js
node -e 'const t=require("fs").readFileSync("packages/kybernos-composio/catalog.js","utf8"); …'   # 100 / 98 / 394420
```

Toutes les lignes citées ci-dessus ont été vérifiées sur HEAD `f3ae9aee` ; aucune ligne de ce dépôt n'a été modifiée, aucun test n'a été lancé.
