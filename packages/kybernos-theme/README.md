# kybernos-theme

Settings › **Theme**: ready-made themes, accent, wallpaper, font, colour tokens, contrast, and
the **thinking animation** (the loader and the words DSH shows while the agent works).

One page, seven vertical tabs, « Essentiel » open by default (there is no Simple/Advanced switch).
Every control stores a value (`DEF`) and something reads it: `test-client.mjs` refuses a control whose
key is not in `DEF`, which is how 41 dead ones went unnoticed before.

| Tab | What it really does, and how |
|---|---|
| Essentiel | theme, accent, wallpaper, font, text size → `overrideTokens` layer, a fixed wallpaper `<div>`, `--dsw-font-family`, `setFontSize` |
| Verre et fond | with a wallpaper: DSH's main surface (`--dsw-alias-bg-base`) becomes transparent so the wallpaper shows; sidebar, fields and menus get a chosen transparency (`--dsw-specific-sidebar-fill`, `-input-major`, `-menu`); frosted/liquid blur by `backdrop-filter` on DSH's stable hooks; wallpaper filters, fit and mirror |
| Couleurs | the 17 pilotable tokens per scheme, accent ramp |
| Texte et forme | text size, ligatures, radii (`--dsw-radius-*` ×0.25 / ×1 / ×1.5), logo and name |
| Animation | the thinking animation (below) |
| Accessibilité | contrast level, reduce animations, focus ring, 44 px targets, underlined links, colour-blind palette (success/error → blue/vermillion) |
| Partage | export YAML / JSON / CSS (real files), JSON import, reset |

The CSS-only effects (glass, ligatures, brand, reduced motion, focus, targets, links) come from one
pure function, `effetsCss(S)`, inserted as a single `<style>`; it only uses DSH's stable hooks
(`data-slot`, `data-composer-card`, ARIA roles), never its hashed class names.

## Layout

| File | Half | Role |
|---|---|---|
| `client.js` | browser | the page, the colour engine, the thinking-animation runtime |
| `index.js` | host | mounts two routes and seeds the two skills |
| `loader-store.mjs` | host | pure `node:fs` store behind `/kybernos-theme/loader-store` |
| `seed-skills.mjs` | host | copies `skills/*/SKILL.md` into `<dsh home>/skills/` without overwriting user edits |
| `skills/loader`, `skills/loading-text` | skills | the two skills (see `skills/README.md`) |
| `vendor/lottie_light.min.js` | host asset | lottie-web 5.12.2 (MIT, see `vendor/NOTICES.md`), served lazily |

Tests (all pure node, CI runs them): `test-client.mjs`, `test-loader-store.mjs`,
`test-seed-skills.mjs`. `test-client.mjs` renders the page with `react-dom/server` when react is
resolvable (`NODE_PATH=<a node_modules with react + react-dom>`) and skips that stage otherwise.
The page on the real GUI is covered by `scripts/check-theme-live.mjs` (see `docs/dev/live-testing.md`).

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
- **Animations**: 14 original drawings (`LD_PRESETS`), the user's own files (SVG, Lottie `.json`,
  GIF/WebP/PNG, 200 KB max), and files written by the `loader` skill.
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
| thinking-animation settings | `localStorage` `kybernos.theme.loader.v1`, copy on disk `<dsh home>/kybernos/loader-settings.json` |
| the *selected* user animations (first paint) | `localStorage` `kybernos.theme.loader.cache.v1` |
| imported animations | `<dsh home>/kybernos/loaders/<id>.json` |
| animations written by the `loader` skill | `<dsh home>/kybernos/loaders/<slug>.svg` |
| « Mon pack » words | `<dsh home>/kybernos/loading-text.json` |

`<dsh home>` is `DSH_HOME`, else `~/.dsh`. The browser copy is what paints first; the disk copy is
what survives clearing site data, another browser, or DSH Desktop picking another port. A newer
`updatedAt` wins. Tests and live checks switch the disk off with
`window.__KB_THEME_HOST_STORE__ = false` before the page loads.

The host routes are **not hot-reloaded**: restart `dsh web` after changing `index.js` or
`loader-store.mjs`. A page without them still works (imports stay in the browser until reload).

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
