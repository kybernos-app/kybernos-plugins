# The theme gallery

Settings › Theme › **Galerie** lists themes to install. A theme is a small file of settings (colours, accent, font,
corners, wallpaper and glass): **data, never code**. Installing puts a copy in *Partage › Mes thèmes*; from then on it
is yours (rename it, edit it, export it), and the gallery only offers an update when the catalogue's version of that
theme moves. The format and what a theme may carry are in `packages/kybernos-theme/README.md` (« My themes »).

## Two catalogues, one answer

| | where | trusted because |
|---|---|---|
| **shipped** | `packages/kybernos-theme/gallery.json` | it travels inside the signed Suite archive (hash-verified by the lifecycle robot): no signature of its own, no network |
| **online** | `catalog/themes.catalog.json` + `.sig` on `main`, asked for at `DEFAULT_URL` (`themes-catalogue.mjs`) | an **Ed25519 signature** over the exact bytes, checked against `packages/kybernos-theme/themes-pubkey.json` |

`GET /kybernos-theme/gallery` answers from the disk only: the cached online catalogue when it is **at least as recent
as the shipped one** (`seq`), else the shipped one. `POST { "op": "refresh" }` asks the network, verifies, caches and
answers the same way. The page asks once when the tab opens, and again on *Actualiser*. The answer always says what
the last refresh did (`online.state`: `never | ok | offline | refused | off`) so the page can explain why it shows
the shipped themes.

What the host refuses, and says why (`online.reason`):

- no key in `themes-pubkey.json` (`no-key`: the online catalogue is not even asked), a signature that is not 64 bytes
  of base64 or not made by a trusted key (`signature`); **nothing is parsed before the signature verifies**;
- a malformed document, a theme that carries an accessibility setting, a duplicate id (`theme`, `schema`, `kind`…);
- a catalogue **older** than the newest one known, shipped or cached (`older`): a replayed old catalogue is a rollback;
- a document over 1 MiB, a signature over 4 KB (`too-large`), a redirect to a URL that is not allowed (`url`).

A refused or unreachable refresh changes nothing: what was shown stays. The cache is verified again on every read, so
a cache edited by hand, or signed by a key that has since been dropped, simply stops counting.

The address is `themesCatalogueUrl` in `<dsh home>/kybernos/settings.json` (`""` turns the online catalogue off). Only
`https` is asked, or `http` on a loopback address (that is how it is tested); no user name or password in the URL.

## Why a theme can be trusted to install

- It goes through the same check as a file you import: known keys only, valid types and ranges, and only fonts and
  wallpapers that already ship with the plugin. It cannot load a font, an image or anything else from outside.
- A catalogue theme **never carries accessibility settings** (contrast, colour-blind palette, reduced motion, focus
  ring, big targets, underlined links): the host refuses a document that does, and the page strips them anyway.
- The page checks again what the host gives it, exactly as it checks a file.
- Nothing is applied until you ask. *Essayer* draws the theme without storing it; closing Settings or reloading gives
  your look back, and any change you make during a trial ends it.

## Publishing (the maintainer)

Sources are `catalog/themes/<id>.json`, one theme per file (the file name is the id), plus
`catalog/themes/_catalogue.json` (`{ "seq", "publishedAt" }`). A theme file:

```json
{
  "id": "encre-papier", "v": 1, "name": "Encre & papier", "author": "Kybernos",
  "description": { "fr": "…", "en": "…" },
  "settings": { "mode": "light", "acc": "#1f2937", "ov": { "light:base": "#f6f7f8" }, "fontText": "georgia", "radius": "sharp" }
}
```

Both languages of the description are required. Raise `v` when a theme changes (that is what offers *Mettre à jour*).

```bash
node scripts/themes-catalogue.mjs build --bump     # raises seq, rewrites packages/kybernos-theme/gallery.json (the SHIPPED catalogue)

# once: the key that signs themes. It is NOT the Suite's release key.
node scripts/themes-catalogue.mjs keygen --out ~/.kybernos-keys/themes.key --embed   # private key stays outside the repo; --embed writes themes-pubkey.json
node scripts/themes-catalogue.mjs sign --key ~/.kybernos-keys/themes.key             # writes catalog/themes.catalog.json and .sig, and replays the gallery's own check
node scripts/themes-catalogue.mjs verify catalog/themes.catalog.json catalog/themes.catalog.json.sig
```

Commit `gallery.json`, `catalog/themes.catalog.json` and `.sig`. Until a key is embedded and a signed catalogue is on
`main`, the gallery shows the shipped themes and says the online catalogue is not active yet: nothing breaks.

`scripts/test-themes-catalogue.mjs` fails when `gallery.json` is not what the sources build, or when a signed
catalogue in `catalog/` is not accepted by the embedded key.

### Adding a community theme

A pull request that adds `catalog/themes/<id>.json`. The checks above run on it (`build` refuses anything the host would
refuse); a maintainer reads the theme, bumps `seq`, signs and merges. Someone who wants a theme that is **not** reviewed
imports its `.json` in *Partage*: the same check applies, and it never reaches the gallery.

## Testing

```bash
node packages/kybernos-theme/test-themes-catalogue.mjs   # the rules of belief: shapes, signature, rollback
node packages/kybernos-theme/test-themes-gallery.mjs     # disk and network, against a local server and a temp folder
node scripts/test-themes-catalogue.mjs                   # the sources, the shipped file and the signed catalogue agree
```

On the real GUI (a sandbox instance, never the real :3080; see `docs/dev/live-testing.md`):

```bash
source scripts/sandbox/env.sh && node scripts/check-theme-live.mjs --only library,gallery   # My themes, then the gallery on the shipped catalogue
```

That covers the shipped catalogue: cards, search, filter, *Essayer* (nothing stored, put back on *Revenir*, on closing Settings),
*Installer*, *Mettre à jour*. The **signed** path needs a key the sandbox trusts, so it is played by hand once per change to
`themes-gallery.mjs`: make a throw-away key (`keygen --out /tmp/…/themes.key --embed`, which rewrites `themes-pubkey.json`: put
it back afterwards), sign a catalogue built from a copy of the sources, serve it with any static server on a loopback port,
set `themesCatalogueUrl` to it in the **sandbox's** `<DSH_HOME>/kybernos/settings.json`, restart the sandbox, open *Galerie*
and use *Actualiser* with the good file, a file changed by one byte, a file signed by another key and an older one (`seq`):
the first must show « Catalogue signé », the others must say why they were refused and keep what was shown. The unit tests
(`test-themes-gallery.mjs`) play the same cases with real keys against a local server on every run.
