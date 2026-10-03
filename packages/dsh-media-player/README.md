# @local/dsh-media-player — lecteur média universel dans l'aperçu DSH

Quand tu cliques un `.mp3` (ou une vidéo) dans la barre latérale **Files** de la
GUI DSH, la place affichait :

> Preview is not available for this file type yet.

Ce plugin remplace ce message par un **vrai lecteur** : `<audio>` / `<video>`
natif avec ses contrôles, le nom du fichier, sa taille et un lien
« Open separately » pour l'ouvrir dans une application externe.

## Formats reconnus

| Type  | Extensions                                                                      |
| ----- | ------------------------------------------------------------------------------- |
| Audio | `mp3` `wav` `m4a` `aac` `ogg` `oga` `opus` `flac` `aif` `aiff` `weba` `wma`       |
| Vidéo | `mp4` `m4v` `webm` `ogv` `mov` `mkv` `avi` `wmv` `3gp` `mpeg` `mpg` `mts` `ts`    |

Le plugin se déclare en priorité `extension` (bande des extensions externes), ce
qui le fait gagner sur la liste `UNVIEWABLE_BINARY_EXTENSIONS` du plugin officiel
d'aperçu de documents, sans le patcher.

## Comment ça marche

Deux points d'extension publics de
`@deepseek-ai/dsh-client-ui-sidebar-documentpreview` :

1. `ctx.documentPreviews.register({ id, extensions, binaryExtensions, priority,
   title, loading: 'bytes-complete', wrap: false })` — on reçoit les octets du
   fichier (`{ kind: 'bytes', data: Uint8Array }`) une fois le document complet ;
2. `ctx.slots.register({ name: 'sidebar.right.tab.document', key: <id> }, Body)`
   — le corps React qui construit une **Blob URL** à partir des octets et monte
   `<audio>` ou `<video controls preload="metadata" playsInline>`.

Détails d'implémentation utiles :

- l'enregistrement se fait dans un `ctx.inject(['documentPreviews'], …)` doublé
  d'une attente bornée (250 ms × 40) : le service peut être fourni par
  `ctx.reflect.provide` et n'est pas toujours disponible au premier tick ;
- `binaryExtensions` = les mêmes extensions que `extensions` : un mp3 n'est
  jamais proposé en lecture « texte brut » ;
- une règle CSS `html[data-ds-theme-source='dark'] .dsh-media-el
  { color-scheme: dark }` fait suivre le thème aux contrôles natifs, sinon ils
  restent blancs au milieu de l'interface sombre ;
- si le décodage échoue, le corps affiche `<p data-state="failed">` au lieu d'un
  lecteur muet ; si le contenu n'est pas binaire, il affiche un message
  « non lisible ».

## Fichiers

| Chemin                      | Rôle                                                      |
| --------------------------- | --------------------------------------------------------- |
| `src/plugin.js`             | source lisible (React + déclaration du plugin)            |
| `client/client.js`          | bundle généré pour le navigateur (`__ModuleLoader__.load`) |
| `index.js`                  | moitié hôte : no-op (`apply`)                             |
| `cordis.patch.yml`          | insertion dans l'arbre cordis du profil                   |
| `scripts/build.mjs`         | `src/plugin.js` → `client/client.js`                      |
| `scripts/build-harness.mjs` | `test/driver.js` → `test/harness.bundle.js` (esbuild)     |
| `test/harness.html`         | page hors application (jetons `--dsw-*` simulés)          |
| `test/verify.py`            | 20 vérifications Playwright + capture                      |

## Installer

```bash
dsh plugin --profile web add link:/Users/miled/dyad-apps/dsh-kybernos/dsh-media-player
```

Le profile manager ajoute la dépendance **et** l'entrée
`@local/dsh-media-player` dans `dsh.profile.bundles`
(`~/.dsh/profiles/web/package.json`). Si la commande se bloque ou est
interrompue, le fichier `package.json.lock` du profil peut rester derrière :
efface-le, vérifie que le lien `node_modules/@local/dsh-media-player` existe et
ajoute l'entrée `bundles` à la main — c'est tout ce que fait `reconcile()`.

Avec `patchReload: live`, l'hôte **recompose à chaud** : la page ouverte reçoit
le nouveau module par le transport HMR, sans redémarrer `dsh web`. Vérifiable
dans la page avec `performance.getEntriesByType('resource')` ou par la présence
de `<style id="dsh-media-player-styles">` dans le `<head>`.

## Vérifier

```bash
cd /Users/miled/dyad-apps/dsh-kybernos/dsh-media-player
node scripts/build.mjs           # reconstruit le bundle navigateur
node scripts/build-harness.mjs   # reconstruit le harnais de test (non versionné)
python3 test/verify.py           # 20/20 attendus, capture /tmp/dsh-media-player-harness.png
```

`test/verify.py` pilote Chromium headless, monte le corps React avec React 18
réel et contrôle : enregistrement, exports, métadonnées, formats, clé de slot,
libellés `fr`/`zh`, helpers (MIME, adresse `dsh-resource://`, taille), décodage
d'un WAV synthétique (durée > 0,3 s), suivi du thème sombre, cas d'échec vidéo,
cas « contenu non binaire », et zéro erreur console.

Preuve en conditions réelles : ouvrir un `.mp3` dans la barre latérale droite →
onglet **Files** de la GUI (`http://127.0.0.1:3080/`).

## Désinstaller

```bash
dsh plugin --profile web remove @local/dsh-media-player
```

Le paquet vit dans le dépôt `dsh-kybernos` (comme `kybernos-plugin`) : le
retirer du profil suffit à rendre le comportement d'origine.
