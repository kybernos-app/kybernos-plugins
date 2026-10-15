# kybernos-theme

Settings › **Theme**: ready-made themes, **your own themes**, a **gallery** of themes to install, accent, wallpaper, font, colour tokens,
contrast, and the **thinking animation** (the loader and the words DSH shows while the agent works).

One page, eight vertical tabs, « Essentiel » open by default (there is no Simple/Advanced switch).
Every control stores a value (`DEF`) and something reads it: `test-client.mjs` refuses a control whose
key is not in `DEF`, which is how 41 dead ones went unnoticed before.

| Tab | What it really does, and how |
|---|---|
| Essentiel | theme (shipped and yours), accent, wallpaper, font, text size → `overrideTokens` layer, a fixed wallpaper `<div>`, `--dsw-font-family`, `setFontSize` |
| Verre et fond | with a wallpaper: DSH's main surface (`--dsw-alias-bg-base`) becomes transparent so the wallpaper shows; sidebar, fields and menus get a chosen transparency (`--dsw-specific-sidebar-fill`, `-input-major`, `-menu`); frosted/liquid blur by `backdrop-filter` on DSH's stable hooks; wallpaper filters, fit and mirror |
| Couleurs | the 17 pilotable tokens per scheme, accent ramp |
| Texte et forme | text size, ligatures, radii (`--dsw-radius-*` ×0.25 / ×1 / ×1.5), logo and name |
| Animation | the thinking animation (below) |
| Accessibilité | contrast level, reduce animations, focus ring, 44 px targets, underlined links, colour-blind palette (success/error → blue/vermillion) |
| Partage | **My themes** (save, apply, rename, export, delete), import a theme file, export of the current look (YAML / JSON / CSS), reset |
| Galerie | themes to **try** and **install** (shipped with Kybernos, plus a signed online catalogue), search, light/dark filter, updates |

The CSS-only effects (glass, ligatures, brand, reduced motion, focus, targets, links) come from one
pure function, `effetsCss(S)`, inserted as a single `<style>`; it only uses DSH's stable hooks
(`data-slot`, `data-composer-card`, ARIA roles), never its hashed class names.

## Layout

| File | Half | Role |
|---|---|---|
| `client.js` | browser | the page, the colour engine, the theme library, the thinking-animation runtime |
| `index.js` | host | mounts five routes, puts the boot sheet in the index through `webserver/index-inject`, seeds the two skills |
| `loader-store.mjs` | host | pure `node:fs` store behind `/kybernos-theme/loader-store` |
| `preset-store.mjs` | host | pure `node:fs` store behind `/kybernos-theme/preset-store` (the theme library) |
| `boot-store.mjs` | host | the boot sheet: the token layer and font the browser half last applied, validated, stored under `<dsh home>/kybernos/theme-boot.json` and rendered as `<style id="kbth-boot">` (see below) |
| `themes-catalogue.mjs` | host | pure rules of the gallery's catalogue: shape of a theme, Ed25519 signature, no rollback, shipped vs signed |
| `themes-gallery.mjs` | host | disk and network behind `/kybernos-theme/gallery` (cache, bounded download, origin guards) |
| `gallery.json` | data | the SHIPPED catalogue, built from `catalog/themes/*.json` by `scripts/themes-catalogue.mjs` |
| `themes-pubkey.json` | data | the public key(s) that sign the online catalogue (empty until the maintainer embeds one) |
| `seed-skills.mjs` | host | copies `skills/*/SKILL.md` into `<dsh home>/skills/` without overwriting user edits |
| `skills/loader`, `skills/loading-text` | skills | the two skills (see `skills/README.md`) |
| `vendor/lottie_light.min.js` | host asset | lottie-web 5.12.2 (MIT, see `vendor/NOTICES.md`), served lazily |

Tests (all pure node, CI runs them): `test-client.mjs`, `test-loader-store.mjs`,
`test-preset-store.mjs`, `test-boot-store.mjs`, `test-themes-catalogue.mjs`, `test-themes-gallery.mjs`, `test-seed-skills.mjs`
(and `scripts/test-themes-catalogue.mjs` for the publishing side). `test-client.mjs` renders the page with `react-dom/server` when react is
resolvable (`NODE_PATH=<a node_modules with react + react-dom>`) and skips that stage otherwise.
The page on the real GUI is covered by `scripts/check-theme-live.mjs` (see `docs/dev/live-testing.md`).

## First paint (the boot sheet)

The look used to come back only when this bundle's JavaScript activated. On a slow link that is long
after the shell has painted: measured on the sandbox with a link throttled to 250 KB/s, the page showed
DSH's default palette from 4.3 s to 38.5 s before the theme applied. Now the browser half posts what it
**persisted** (the token layer and the font, never a trial being previewed) to `POST /kybernos-theme/boot`;
the host validates it, keeps it in `<dsh home>/kybernos/theme-boot.json`, and adds it to every index render
through DSH's own `webserver/index-inject` seam (the seam DSH's built-in theme bootstrap uses) as a
`<style id="kbth-boot">` right after `<head>`. The browser half removes the sheet two frames after its own
layer is in place, so the sheet can never outvote a later choice.

- What crosses the route ends up inside a `<style>` of every page, so it is never taken as CSS: token names
  must be `--dsw-*`, values are matched against a strict grammar (hex, rgb[a], hsl[a], lengths), the font
  against a stack grammar, and the sheet is built from the validated parts only (`boot-store.mjs`).
- Not in the sheet: the wallpaper (a `div` the browser half adds) and the effects sheet (glass, motion,
  focus ring). They still appear when the bundle activates.
- Without the seam (a DSH that does not emit `webserver/index-inject`) nothing is injected and the page
  behaves as before.

## My themes

A **theme** is a name plus the settings it retains, grouped so that the person chooses what travels
with it: colours and accent (always), font, corners, menu icons, glass and wallpaper, accessibility. Accessibility
is off by default when saving: contrast, the colour-blind palette and big targets are a need of the
person, not a style, so a theme never changes them unless it was saved with them.

- **Essentiel** shows the shipped themes, then *My themes* and a `+` button. The summary line under
  them says which theme is in use and whether it is *modified*: a setting the theme retains has moved
  (the mode is left out on purpose, DSH's own light/dark button changes it from elsewhere). A shipped
  theme is never edited: *Save as…* makes a copy. Your own theme can be *updated* in place.
- **Partage** is the library: apply, export (the JSON file is shown, with *Copy* and *Download*),
  rename, delete (confirmed in place), and *Import*. Importing **adds** a theme and applies nothing; an
  old export of the whole look (no frame) still imports, as a theme.
- A theme is **data**, never code. The only values it can carry are the ones `sanitiserImport`
  accepts: known keys, valid types and ranges, and fonts and wallpapers that already ship with this
  plugin. A file cannot load a font, an image or anything else from outside; its name is drawn as text.
  The same check runs when a file is imported, when the browser copy is read, and when the disk copy
  comes back; `preset-store.mjs` checks the shape again on the way in and out (it cannot know the
  fonts and wallpapers without copying their tables, so it leaves the meaning to the browser).
- The file format: `{ "format": "kybernos-theme-preset", "version": 1, "name", "author"?, "settings": { … } }`.
  `PRESET_GROUPS` in `client.js` lists what a theme may retain; `SETTINGS_KEYS` in `preset-store.mjs`
  must stay equal to it (`test-client.mjs` fails when they drift).
- Up to 100 themes, names up to 40 characters and unique (a name taken by a shipped theme counts).

## Menu icons

The sidebar menu can be drawn by a **set** of icons: grey at rest, in the entry's own colour on the open
page, flat fills only (no outline). Twenty-one sets ship, chosen in Settings › Theme › **Icônes** (a tab
next to Animation; Essentiel only names the set in use): *Classic* (the application's line icons, the
default), five sober ones (*Flat*, *Duotone*, *Bauhaus*, *Soft gradient*, *Tile*) and fifteen with their own
technique: *Matrix* (dots), *Mondrian* (blocks), *Rings*, *Isometric*, *Kawaii* (two eyes), *Blinds*
(vertical slats), *Facets*, *Long shadow*, *Halftone*, *Bubbles*, *Honeycomb*, *Constellation*, *Two-tone*,
*Stamp* and *Nature*.

- **A visible link with the entry**: every set draws the same nine things, so the icon says what the
  entry is: a cloud (Cloud Computer), a robot head (Kyber), a bar chart (Dashboards), three people (Agent
  Teams), a folder (Workspaces), a picture (Creations), a cog (Automations), an open book (Skills), a
  plug (Connectors). A set changes how they are drawn, never what they are. `ICON_PICTO` holds the
  shared silhouettes; a set is either a renderer over them (Kawaii, Blinds, Long shadow, Halftone, Bubbles,
  Two-tone, Stamp), a bitmap (Matrix, Honeycomb) or hand-drawn (the others).
- **Cut-outs are holes**: eyes, the picture's inside, the cog's hub are SVG masks, not white fills, so
  they show whatever is behind the row (light, dark, hover, selected).
- **Where it is stored**: the `iconSet` setting, stored with the look; a theme can retain it (its own
  group in *Save as theme*), and a shipped theme may carry one (`skinPatch`, and the gallery themes).
- **How**: the drawings are pure code in `client.js`, between the `icon-sets` markers (cut out and run
  as it ships by `test-icon-sets.mjs`). `appliquerIcones` publishes the choice on
  `window.__KB_ICONSETS__` (`current()`, `svg(entry, on, size)`, `sets`) and fires `kb-icons-change`;
  `kybernos-plugin`'s menu reads it at render and keeps its own line icons when there is no
  registry or the set is *Classic*. At rest nothing is coloured: the icons follow the row's text colour.
- **Adding a set**: one drawing per entry (9: `cloud kyber dash teams ws creations auto skills plug`), a
  line in `ICON_SETS` with its French and English name; the tests require every entry at rest and open,
  no stroke, inside the 24 × 24 box, and a look that no other set already has.
- The entry colours are one table (`ICON_HUES`); the *Classic* card is drawn by the application, which
  lends its line icons through `window.__KB_MENU_CLASSIC__`.

## The gallery

**Galerie** lists themes to install. There are two catalogues and one answer: the **shipped** one
(`gallery.json`, it travels inside the signed Suite archive and works offline) and the **online** one
(`themes.catalog.json` + a detached Ed25519 signature, verified by the HOST before the page ever sees it,
cached on disk and verified again on every read). The signed one shows when it is at least as recent as the
shipped one; an older one is refused as a rollback; a refused or unreachable refresh changes nothing and the
page says why. Opening the tab asks the online catalogue once (`themesCatalogueUrl` in
`<dsh home>/kybernos/settings.json`, `""` turns it off); nothing else in this plugin uses the network.

*Essayer* draws a theme without storing it (closing Settings or reloading gives the stored look back, any change
made during a trial ends it; a theme of the other mode switches DSH's mode for the trial, and reload or closing Settings
switches it back; only killing the tab in the middle can leave the new mode behind); *Installer* copies it into My themes (source « gallery », with its catalogue id
and version); an installed copy gets *Mettre à jour* when the catalogue's version moves. A catalogue theme never
carries accessibility settings. How it is published, signed and tested: `docs/dev/theme-gallery.md`.

## The thinking animation

DSH mounts a block `[data-chat-running]` at the bottom of the chat while the agent works: a 14 px
whale tail, then « Deep diving for 12s ··· » drawn by `TextShimmer`. The block is mounted again
for every answer. The plugin changes it **without touching the engine**:

1. a `MutationObserver` spots each new `[data-chat-running]`;
2. it hides the whale tail (`data-kb-ld-hide`) and inserts the chosen animation first in the block;
3. it replaces DSH's phrase (`chat.deepDiving`, read in the active language through
   `ctx.locale.bind('chat')`) by one word of the chosen ambiance, keeping DSH's own template and
   duration. DSH writes the text twice: a text node, and the `data-shimmer-text` attribute that
   the sweeping highlight paints with CSS `::after`. **Both** are rewritten, and re-written after
   every once-a-second update from React;
4. an unknown structure is left alone; nothing in here can throw into DSH; disabling the plugin
   gives the whale tail back.

A draw happens once per answer: a block that comes back within 1.5 s is the same answer.

### What the user controls

- **Rotation** of up to 4 animations, drawn at random (never the same twice in a row, optional)
  or in order.
- **Animations**: 34 original drawings (`LD_PRESETS`: geometric ones, then plants, objects, animals and
  manga-flavoured ones, all 48×48 SVG animated by the `.kb-ld .a-*` classes of `client.js`), the user's own
  files (SVG, Lottie `.json`, GIF/WebP/PNG, 200 KB max), and files written by the `loader` skill. The
  picker's cards are small (about 105 px wide).
- **Ambiances** (`LD_PACKS`): the DSH original and 11 trades, words in French and English, plus
  « Mon pack » (the user's own words, or those written by the `loading-text` skill).
- **Settings** (folded): size 14/24/40 px, accent tint, speed, delay before showing, keep the
  words, change the word every 8/15 s, show the duration.

The Lottie drawings and Dribbble pack the feature was designed around are **not** bundled
(they belong to their author); the page tells the user to import their own files.

### Rendering imported files

Imported content is never injected as HTML. An SVG goes through `<img>` (several colours) or a
CSS `mask-image` (a single `currentColor` colour, so it can be tinted: an animated SVG does keep
animating inside a mask); a GIF/WebP/PNG through `<img>`; a Lottie through lottie-web, loaded on
demand from `/kybernos-theme/vendor/lottie.js`. The browser removes scripts, event handlers and
external references before saving; the host **refuses** (never rewrites) anything that still
contains any (see `loader-store.mjs`).

## Where things live

| What | Where |
|---|---|
| theme (look) | `localStorage` `kybernos.theme.v1` |
| My themes | `localStorage` `kybernos.theme.presets.v1`, copy on disk `<dsh home>/kybernos/theme-presets.json` (one document, the newer `updatedAt` wins as a whole) |
| the online gallery catalogue | `<dsh home>/kybernos/themes-catalogue/` (the verified document and its signature) |
| thinking-animation settings | `localStorage` `kybernos.theme.loader.v1`, copy on disk `<dsh home>/kybernos/loader-settings.json` |
| the *selected* user animations (first paint) | `localStorage` `kybernos.theme.loader.cache.v1` |
| imported animations | `<dsh home>/kybernos/loaders/<id>.json` |
| animations written by the `loader` skill | `<dsh home>/kybernos/loaders/<slug>.svg` |
| « Mon pack » words | `<dsh home>/kybernos/loading-text.json` |

`<dsh home>` is `DSH_HOME`, else `~/.dsh`. The browser copy is what paints first; the disk copy is
what survives clearing site data, another browser, or DSH Desktop picking another port. A newer
`updatedAt` wins. Tests and live checks switch the disk off with
`window.__KB_THEME_HOST_STORE__ = false` before the page loads.

The host routes are **not hot-reloaded**: restart `dsh web` after changing `index.js`,
`loader-store.mjs`, `preset-store.mjs` or `themes-gallery.mjs`. A page without them still works (imports stay in the browser until reload).

## Limits worth knowing

- **Terminal / TUI.** This plugin skins the web GUI only. There is no Terminal tab: colour depth, cursor
  and ANSI palette belong to the TUI's own configuration.
- **DSH's hooks.** Glass and the brand toggle rely on `data-slot="sidebar"`, `data-slot="sidebar.brand.*"`,
  `data-composer-card` and ARIA roles. If DSH renames them the effect silently stops (the tokens and
  the wallpaper keep working). The veil makes `--dsw-alias-bg-base` transparent for the whole app:
  one element used it as a *text* colour (the workspace tile in `kybernos-cloud`, fixed); a future DSH
  element doing the same would show up as invisible text. Probe with the colour set to magenta.
- **The wallpaper is not visible inside Settings** (the settings screens use other surfaces); it shows
  behind the chat and the other pages. The « Verre » tab has a small preview for that reason.
- **Line height and density** have no lever in DSH (only the font-size delta is exposed), so there are
  no such controls.
- **Words and ambiance names** are French and English; other languages fall back to English.
- **Light scheme** was checked by removing the dark attribute client-side (see
  `docs/dev/live-testing.md`), never by changing the user's stored preference.
- A colour compiler (`lib/` + frozen Catppuccin/Rosé Pine/Selenized palettes) was prepared but never wired in; it was removed as dead code (see git history before this change if it is ever built).
