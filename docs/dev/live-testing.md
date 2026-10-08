# Testing against the live DSH GUI

Unit tests prove a function; they do not prove a page. For anything the user
*sees* (a settings page, a translation, a layout), drive the real GUI of a
running `dsh web`. This page explains how to sign in without a human, what the
repo gives you, and the traps.

## Signing in to `dsh web`

`dsh web` answers **401** to anything without a session. There are two ways in.

| Way | Where it comes from | Lifetime | Use it for |
|---|---|---|---|
| **Token URL** | `~/.dsh/logs/dsh-web.url` (`http://127.0.0.1:3080/?token=…`), written when `dsh web` was started by the relance script | until `dsh web` restarts | opening the GUI by hand |
| **Signed session cookie** | derived from the *persistent* secret `client-connection/browser-session` in `.credentials.yaml` of the DSH home (`$DSH_HOME`, else `~/.dsh`) | 24 h, and it survives restarts | scripts and automated tests |

**Prefer the cookie.** The token in `dsh-web.url` ages badly: as soon as `dsh web`
is restarted by hand (it then runs in a terminal and no longer rewrites the
file), the file keeps the old token and the GUI answers 401. The cookie is signed
with a secret DSH persists, so it keeps working.

The cookie is:

```
name  = "dsh-auth-" + base64url(sha256(authority))      authority = "127.0.0.1:3080"
value = "v1." + body + "." + base64url(hmac_sha256(secret, body))
body  = base64url(JSON {version:1, authority, issuedAt, expiresAt})
```

`scripts/cdp-lib.mjs` (`cookieDeSession`, `poserCookie`) and `scripts/dsh-relance.mjs`
(`authCookie`) implement it. **Never print the secret, the token or the cookie** —
not in logs, not in test output, not in a chat.

Quick check that sign-in works (prints a status code only):

```bash
node --input-type=module -e "
import { cookieDeSession } from './scripts/cdp-lib.mjs'
const c = cookieDeSession('127.0.0.1:3080')
console.log(c === null ? 'secret unreadable' : (await fetch('http://127.0.0.1:3080/', { headers: { cookie: c.nom + '=' + c.valeur } })).status)"
```

`200` = signed in, `401` without the cookie is normal.

## A signed-in headless Chrome: `scripts/live-page.mjs`

```js
import { openLivePage, waitFor, clickText } from './live-page.mjs'
const live = await openLivePage()          // KB_HOST=127.0.0.1:3080 by default
const { page } = live                      // CDP page from cdp-lib.mjs
await page.evalJs('document.title')        // → { val } or { err }
await clickText(page, 'Settings')          // real mouse event at the element's centre
await page.shot('/tmp/page.png')           // screenshot
await live.close()                         // kills Chrome, removes the profile
```

- It starts its **own** headless Chrome with an empty throw-away profile, sets the
  cookie, opens the GUI and waits for the shell to paint. Nothing you inject
  (localStorage, a pseudo dictionary…) ever reaches your own browser.
- It throws a readable error when Chrome is missing (`KB_CHROME` to point at it),
  when the secret is unreadable, or when the GUI never renders.
- The GUI has no URL routes: pages are reached by clicking. `clickText` matches an
  element's own text, ignoring the `⟦ ⟧` pseudo-translation marks.
- The built-in browser pane of the Claude desktop app cannot be used for this: it
  has no cookie access, so it stops at the 401 page.

## ⚠ Switching language persists DSH's language — on your machine

Pressing « Use » on a translated language makes DSH store **its own** language
preference (`locale.preference` in the profile's `cordis.patch.yml`). That file is
yours, not the throw-away browser's. Every script that switches language therefore:

1. refuses to start (exit 3) unless the stored language is `en` — it never
   overwrites a choice of yours;
2. puts English back in a `finally` (and on SIGINT/SIGTERM) by pressing « Use » on
   English — or on French, which also sends DSH back to English;
3. reads the stored value back afterwards and fails if it is not `en`.

The window is a few minutes: during it, a browser you reload would show the test
language. If a run is killed hard (SIGKILL, power loss) and the check says
`NOT RESTORED`, put it back by hand: open Settings → Language and press « Use » on
English, or run the snippet in `scripts/lib-language-flow.mjs` (`restoreEnglish`).
The profile name defaults to `web` (`KB_PROFILE`).

## The Language page, end to end: `scripts/check-language-live.mjs`

```bash
node scripts/check-language-live.mjs --shots /tmp/shots   # screenshots of every step
```

The LLM is replaced by a stub in the page (each string comes back as `⟦text⟧`), so
the run is free and deterministic; everything else is real — the page, the ISO
list, the engine, the localStorage stores, DSH's locale service and dictionaries.
It checks: the ISO list and its search, that adding a language starts nothing, the
Start button, the progress bar (by area, with time left), pause and resume, a
failing model (readable message, nothing counted as translated), removal with
confirmation, a right-to-left language, DSH's own screens following the language,
the DSH language selector listing it, hardcoded settings pages translated live,
and the stored-language restore described above. Exit code 0 / 1 / 3.

The page carries stable hooks for this: `[data-lang="<id>"]` on a row,
`[data-act="start|pause|use|use-now|menu|remove|…"]` on its buttons,
`[data-iso="<code>"]` on the picker entries. Use them instead of clicking by text:
under a translated UI the labels change.

It checks the **help** too: the « ? How it works » button, that it opens on the first
visit and remembers being closed, that the CSS mini-mock really animates (≥ 15 animations
running, time advancing, steps lighting up in turn at 1 s / 6 s / 9 s), and that
`prefers-reduced-motion` stops every animation and shows the final state (emulated through
`Emulation.setEmulatedMedia`). Tooltips are plain `title` attributes: the test reads them.

It also checks the **two surfaces and their synchronisation**: DSH's own
General › Language row (kept — it is the only door when the plugin is off) with the
« Manage languages and translations here » pointer under it, the choice made in either
place showing in the other, and Settings › Account no longer carrying a Language field.

### The Language plugin switched off

`lib-language-flow.mjs` can simulate the optional plugin being left out of the profile
(`flow.languagePlugin(false)`, steered by `localStorage.__kb_disable_lang`, applied at the
next load): its entry still loads — DSH waits for every entry — but does nothing. The test
then proves that the translated languages are **still listed in DSH's selector and still
apply**, for Kybernos and for DSH's own screens, because that part lives in the always-on
runtime of the core plugin (`window.__KB_LANG_RUNTIME__`), not in the optional plugin.
Note for anyone extending this: DSH's module loader **replaces its own `load`** after the
first module, so the simulation wraps the *property* (an accessor), not its value of the moment.

Unit-level coverage (no browser): `packages/kybernos-language/test-client.mjs` (engine, page
logic; it loads the real runtime from the core plugin), `packages/kybernos-plugin/test-lang-runtime.mjs`
(the runtime in isolation: registration, following DSH's selector, the boot grace period, and the
disk copy against the real store module), and, for the host, `packages/kybernos-plugin/test-i18n-translate.mjs`
(the translation route) and `test-i18n-store.mjs` (the on-disk store and its route).

## The disk copy of the translations: `scripts/check-language-disk-live.mjs`

Translations are kept in the browser's localStorage **and** on the disk
(`~/.dsh/kybernos/i18n/<lang>.json`, host route `/kybernos/i18n-store`, see
`packages/kybernos-plugin/i18n-store.mjs`). The always-on runtime reconciles the two at boot
and pushes later writes as deltas.

```bash
node scripts/check-language-disk-live.mjs
```

It runs the whole chain in a real browser: translate → the file appears; a browser with
nothing gets the language back from the disk and DSH shows it; removing it removes the file
(and leaves a tombstone); a host that is down or has no route leaves the browser copy intact
and the page says so. The « disk » is a **throw-away folder** served by the REAL route code
(`fakeDiskRoute` in `lib-language-flow.mjs`, requests intercepted over CDP): your `~/.dsh`
is neither read nor written, and it works before DSH has been restarted with the route.
Like the other language scripts it switches DSH's language and restores English.

**Every other live script runs with the disk copy off.** `openLivePage` sets
`window.__KB_I18N_HOST_STORE__ = false` in each page, because the stubbed model produces
pseudo-translations (`⟦text⟧`): written to the real disk, they would replace a real
translation. Only a script that passes `{ hostStore: true }` (and intercepts the route, as
above) gets the copy.

## Before it is merged: test a worktree's client on the real GUI (`scripts/lib-bundle-swap.mjs`)

`dsh web` serves what the shared tree holds. To see a plugin's browser half from your worktree *without* touching the shared
tree, rewrite the response in the test browser:

```js
import { swapBundles } from './lib-bundle-swap.mjs'
const swap = await swapBundles(page, [{ name: 'kybernos-language' }])   // after fakeDiskRoute, pass its pattern in extraPatterns
await page.send('Page.reload', {})
swap.report()   // [{ file, replaced: true }]  (false = the shared tree has uncommitted edits of that file)
```

Plugin clients come as ONE combined request (`/plugins/??a/client.js,b/client.js&rev=…`) whose hash validates the list, so the
helper rewrites the response, found by the text of the shared file. It switches the HTTP cache off (a cached bundle never reaches
the interceptor). Only client code can be tested this way: host code loads when `dsh web` restarts, and you do not restart it.

Traps met while writing it: `page.send` returns the raw message (`{ id, result }`), and two interceptors on the same `Fetch`
event must each ignore the other's requests (`Fetch.enable` replaces the patterns of an earlier call).

## A bundle the user's DSH does not list yet: a second instance (`scripts/sandbox/*.sh`)

A **new** bundle, or any **host** code, cannot be tried on the user's `dsh web`: it is not in their profile and a host change
needs a restart, which you do not do. Build a second DSH that serves this checkout:

```bash
scripts/sandbox/setup.sh          # a clone of the real `web` profile, every @local link on this checkout, new bundles added
scripts/sandbox/start.sh          # port 3098 (never 3080), own HOME and DSH_HOME, log in the sandbox folder
source scripts/sandbox/env.sh     # KB_HOST, DSH_HOME, HOME: what the live checks read (`kb_sandbox_leave` undoes it)
scripts/sandbox/stop.sh           # that instance only
```

No credential, key or session is copied, the paid server module and the relaunch tool (it targets :3080) are left out; the new bundles of the checkout are added and the checkout is the one workspace. HOME
is set too, because some bundles still write under `~/.dsh` when only DSH_HOME is: with HOME alone changed, the real files
stay untouched (fingerprint `~/.dsh/.credentials.yaml`, `profiles/web/package.json`, `kybernos/i18n/*.json` before and after).
Host code is not hot-reloaded: `stop` then `start` after editing an `index.js`; client code is read from the checkout at each
page load. The first load asks for an API key (« Configure later »); a chat for a git folder only exists once a first message
was sent (the turn then fails for lack of a key, which is fine): `check-changes-live.mjs` does both by itself.

## The Changes chip: `scripts/check-changes-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-changes-live.mjs --shots /tmp/shots
```

It refuses to run against `:3080` (exit 3: that DSH does not load the bundle). It checks the real data path (the chip, the
host's `fichiers`, the four pills stepping aside), every state through the seam, an action end to end, French, a narrow
window and the seam missing. **Every POST of `/kybernos-sessions/*` is answered inside the page by the check** (fail-closed):
the sandbox runs git in the user's real repository folder, so a real commit must be impossible, whatever the page asks.

## The help of every plugin: `scripts/check-help-live.mjs`

Each bundle has a `packages/<dir>/help.json` (what it is, how to use it, where to find it, one thing worth knowing, in French and
English). `scripts/build-catalog.mjs` validates it and ships it in the catalogue; the Suite shows it on the module's page, and the
« ? How it works » button of a plugin page (`window.__KB_HELP__.Help`, published by the hub) shows the same text.

```bash
node scripts/test-help.mjs                   # no GUI: the shape, every bundle has one, the buttons are guarded and ask for their own bundle
source scripts/sandbox/env.sh && node scripts/check-help-live.mjs --shots /tmp/shots
```

The live check opens each page that carries the button (Theme, AI Provider & Models, Commands, Workers, About, Ollama Local Models,
Memory & Lessons, General, Kybernos Suite, Skills), opens the card, checks it holds the text **read from the file**, that Escape closes
the card and not the Settings dialog behind it, then French, a module's page in the Suite, and that Atlas, Language and Auto Routing
(which already had a help) do not get a second button. Two traps: the Settings dialog closes on Escape with a capture listener, so
anything that handles Escape inside it must listen in capture and stop the event only when it has something to close; and the core
rewrites French phrases to English on Settings pages while the document language is English (a French test must set
`document.documentElement.lang` too, or compare without quotation marks).

## The run, the ring and the test marks: `scripts/check-language-run-live.mjs`

```bash
node scripts/check-language-run-live.mjs --worktree --shots /tmp/shots    # this checkout's client, screenshots of the key steps
node scripts/check-language-run-live.mjs --worktree --user-copy           # start from a COPY of ~/.dsh/kybernos/i18n/es.json
```

It replays an incident that really happened: a language whose texts were all written by a test run (`⟦…⟧`) and reached the
disk. A: the situation (built with the pseudo stub, or your copy). B: the page no longer counts the marks as translations (grey
bar with the real count, banner, no « Use »). C: « Translate these texts again » replaces them while the page says the run lives
in the tab and the ring in the sidebar footer follows it from the workspace (clicking it opens the Language page); browser and
disk end up clean and a reload does not bring the marks back. D: a run cut with the tab is taken over at the next load, left
alone while the heartbeat is fresh, and left alone when the automatic resume is off.

The « disk » is a throw-away folder behind the real route code and the model is a stub in the page, so your `~/.dsh` is never
written (`--user-copy` only reads `es.json`, once, into that folder); nothing presses « Use », so DSH's language is untouched.
`openLivePage` sets `window.__KB_I18N_PSEUDO_OK__ = true` for every other script, because they translate with the
pseudo-translating stub; this one switches it with `localStorage.__kb_pseudo_ok` instead, since the guard is what it tests.

## The Theme page, end to end: `scripts/check-theme-live.mjs`

```bash
node scripts/check-theme-live.mjs --shots /tmp/shots      # screenshots of the main steps
node scripts/check-theme-live.mjs --only skins,persist    # just those sections (the baseline always runs)
```

Nothing is stubbed: the page, real CDP mouse and key events, DSH's theme service, the token
layer, the wallpaper `<div>`, the font style tag, the `kybernos.theme.v1` store and the reload at
boot are all real, and the assertions read **computed styles** (the 17 `--dsw-*` tokens on
`<body>`, the wallpaper's `opacity`/`filter`, `--dsw-font-family`), never the source. It checks:
the page (no Simple/Advanced switch: seven vertical tabs, « Essentiel » open after every load)
and its controls; every dark and mode-less theme (stored, tokens equal to the pack's
palette, wallpaper, pill) and « DSH default » giving back the 17 native values; persistence (a
reload applies theme, accent, wallpaper, font and DSH's text size **before Settings is opened**);
accent dots (a near-invisible accent is lightened to 3:1), hex field (invalid input marks `.bad`
and changes nothing), picker and reset; wallpaper categories, the « None » tile, tiles, visibility
/ blur / tint, and whether it can actually be *seen*; the font selector (search without accents,
arrows, Enter, Escape, click outside) and the text size; the seven tabs; Colors (what the page
shows equals the applied tokens, token editor, footer count, reset); Accessibility (contrast
levels measured as WCAG ratios); « Reset all » (it *replaces* the state); Sharing (export, copy,
import: only a `.json` is accepted, anything else is refused with a visible note); the « Animation » tab
and the thinking animation in DSH's bottom status line (below). A console error from `[kybernos-theme]`
or an uncaught exception from one of its functions fails the section it happened in (a second CDP
connection listens).
Exit code 0 / 1 / 3 (3 = no Chrome, no GUI, the Theme page unreachable, before any measure).

The controls of the tabs after « Essentiel » used to be partly dead (they wrote keys nothing read).
They are all wired now, and the `gaps` section **asserts** it: every control is moved with a real click
or key, then measured as *persisted* (its position is back after a reload) and *applied* (a fingerprint
of the page — custom properties, attributes, a hash of the plugin's own CSS, text metrics, the
wallpaper's style — changes); it prints a `control | persisted | applied` table that must read all
`yes`. The same wiring is measured in detail, on computed styles, by `verre` (wallpaper visible, glass,
transparency tokens, image filter, fit, mirror, the preview), `forme` (ligatures, radius tokens, logo),
`access` (reduced motion, focus ring with a real Tab key, 44 px, link underline, colour-blind palette),
`boot` (every new key applied before Settings opens; « Reset all » removes the effects) and `sharing`
(three real export formats, the copy argument, the CSS export’s 17 × 2 tokens, a JSON round trip).
`light` measures the contrast of **every visible text** of the page, its picker and its word pack in the
Light scheme, **without touching the preference** (see the trap below), and checks that Dark kept its
colours; `french` fails on any French an English interface still shows (see the trap below).

Besides ✓ / ✗ it prints two blocks that are **not failures**: *KNOWN GAPS* (empty when there is
none) and *OBSERVATIONS*. A ✗ is a real defect: the check stays red until it is fixed.

### The « Animation » tab and the bottom status line

Three sections (`animation`, `runtime`, `disk`) cover the « Animation » tab. The tab's settings live in their own key,
`kybernos.theme.loader.v1` (the theme page's « Reset all » must not touch it); a second half of the
feature writes imported animations and the user's word pack **to the disk through a host route**
(`/kybernos-theme/loader-store`). The script therefore sets `window.__KB_THEME_HOST_STORE__ = false` in
every document (`Page.addScriptToEvaluateOnNewDocument`) and clears both loader keys with every fresh
start: nothing of the tab can reach `~/.dsh`. (The very first document is loaded inside `openLivePage`,
before the flag can be installed; it can only GET a route.) The yellow « the disk does not answer »
banner is hidden by that flag, so one step turns it back on **and blocks the route in the browser**
(`Network.setBlockedURLs`, verified with a `fetch` that must fail) before looking for the banner.

- `animation` drives the page for real: four blocks and nothing of the library until the picker opens;
  the picker (14 examples, rotation capped at 4, filters, `Escape`, focus returned, `Tab` kept inside);
  the ambiance select (13 entries, accent-insensitive search, arrows, `Escape` that must not close
  Settings); the word pack; persistence of the choice and of speed / delay / size across a reload;
  « Rétablir ces réglages »; imports through a `DataTransfer` set on the file input (a good SVG that
  must animate as a CSS mask — checked by comparing pixel samples of the card, with the catalogue's
  spinning ring as the control of that measure —, a hostile SVG that must be cleaned, a 210 KB file,
  a `.exe`, a JSON that is not Lottie). Lottie itself is not tested: its engine comes from the host route.
- `runtime` cannot trigger a model run, so it **builds a faithful copy** of DSH's running block in the
  live page and lets the plugin's own `MutationObserver` decorate it. The copy uses DSH's real hashed
  classes, read from its loaded stylesheets (`ChatView.module.css`; the TextShimmer module, which lives in
  the global `assets/index-*.css`), and DSH's real structure: the label is a **text node** in the base copy
  but only a **`data-shimmer-text` attribute** painted by `::after` in the decoration copy, and a
  `setInterval` rewrites both once a second, as React does. The settings are read at page load, so each
  scenario writes the loader key and reloads. It checks the loader is the first child of the running
  content, the whale is hidden, size 14 / 24 / 40 px, delay, mono colour = the running text's colour (or the
  accent), order mode, a re-mount within a second, `keep` off, and that **both** copies and the painted
  `::after` content carry the replaced word after three rewrites. A screenshot goes to the OS temp folder
  (path printed), never into git.
- `disk` runs the **real host half** (`packages/kybernos-theme/loader-store.mjs`) against a temp folder used as
  the DSH home, without restarting `dsh web` and without touching `~/.dsh`. The browser's requests to
  `*/kybernos-theme/loader-store*` and `*/kybernos-theme/vendor/lottie.js*` are paused with CDP
  `Fetch.enable` and answered from node (`serveLoaderStore` for the first, the vendored `lottie_light.min.js`
  for the second). The handler never lets a request through — after the section it fails them — and a probe
  GET must be answered by it before the page is allowed to talk (otherwise the section aborts). For this
  section only, the flag script is removed (`Page.removeScriptToEvaluateOnNewDocument`) so the plugin's host
  mode is ON; the `finally` sets the flag again in the live page and in every future document, waits for
  the debounced push, stops the interception and deletes the temp folder. It checks: settings reach
  `loader-settings.json` within ~1 s and come back in a profile with cleared localStorage; a good SVG becomes
  `loaders/<id>.json` (svg / mono / ≤ 200 KB), is listed after a reload, selectable, deletable (file gone); a
  hostile SVG reaches the disk already cleaned, and a record that still holds `<script`, POSTed through the
  page's own `fetch`, is refused as a normal HTTP 200 `{ok:false,error}` (so no red « Failed to load
  resource » line in the console) and no file is written — malformed requests stay HTTP 400; a bare `loaders/<name>.svg` dropped by hand
  appears as a Skill card within one poll (4 s) while an invalid one is only listed in `skipped`;
  `loading-text.json` makes « Mon pack » selectable; a real Lottie loads the engine and animates, one with an
  external image is refused by the host with a red banner; a 500 or an invalid JSON from the GET leaves the
  yellow « disk does not answer » banner without breaking the page. The yellow banner and the yellow import
  note share a class: tell them apart by `[data-kb=ld-note]`.

### ⚠ A theme can persist DSH's mode and font size — on your machine

The plugin drives DSH's own theme service: every change calls `setTheme(mode)` and
`setFontSize(px)`, which DSH stores in the profile (`ui-theme` in `cordis.patch.yml`), not in the
throw-away browser. (A boot used to write the plugin's own size, 15, over DSH's; it now
*adopts* DSH's size into the store, and a check pins that.) So the script:

1. reads that file before it starts, and uses the stored mode as the one to keep;
2. clicks only Dark and mode-less themes while that mode is Dark (only mode-less ones otherwise,
   and it then skips « DSH default » and « Reset all », which force Dark); it never clicks a Light
   theme, never uses « Surprise me », never touches the Mode buttons except to restore;
3. before **every** click, key or colour pick, checks that DSH still reports that mode
   (`html[data-ds-theme-source]`): if it moved — even by someone else — the run stops at once
   and puts it back;
4. moves the text size by +1 px for a few seconds and puts back the size it found (« Reset all »
   also sets it to the default, 15: the final check catches that too);
5. in a `finally` (and on SIGINT / SIGTERM) verifies both values in the file, restores them
   if needed and prints `!!! NOT RESTORED` if it cannot. A hard kill can still leave them moved:
   set the mode in Settings › Theme and the size with the text-size slider.

### Hooks and traps

- Hooks are classes: `.kbth-skin`, `.kbth-dots .kbth-dot`, `.kbth-cat`, `.kbth-wp`, `.kbth-fsbtn` /
  `.kbth-fssearch` / `.kbth-fsopt`, `.kbth-adv-tab` (`.on` = open), `.kbth-adv-pane`, `.kbth-tok`,
  `.kbth-adv-editor`, `.kbth-foot`, and `[data-kb=theme-import-note]` for the import result. A slider has no id: find its `.kbth-sl` block by label (either
  language). The Mode row is the segment reading System / Light / Dark.
- Sliders are driven with real `Home` / `End` / arrow keys on the focused range input (exact and
  deterministic); colour pickers by the native value setter plus an `input` event.
- **`Escape` closes the whole Settings dialog** unless the font search is focused: the plugin stops
  the key with a *native* listener on that field, and the check presses a real key on it. A React
  `onKeyDown` alone would not do — the dialog listens natively.
- The first tile of every wallpaper category is « None »: real tiles start at index 1.
- The tabs are indexed (`TAB` in the script): Essentiel, Verre et fond, Couleurs, Texte et forme,
  **Animation**, Accessibilité, Partage (« Conversation » and « Terminal » are gone). A tab inserted in the middle moves every
  index after it; the `advanced` section checks the names in order, so a shift is reported there first.
- The wallpaper `<div>` has `pointer-events: none`, so `elementsFromPoint` never lists it: to
  know whether it is visible, look for an opaque element *above* each sampled point instead.
- Tokens are read on `<body>` (that is where DSH and the layer declare them), not on `<html>`.
- The Light scheme is measured **without pressing Mode / Light**: the `light` section removes
  `data-ds-dark-theme` from `<body>` in the page only (client-side, never persisted; the guard keeps
  watching `html[data-ds-theme-source]`, and the attribute is put back in a `finally`). In each of 18
  views (the seven tabs, the font list and the ambiance list with no match, the settings disclosure,
  the picker's three tabs, the rotation filled and played in order, the word pack empty and with two
  words) it walks **every text node** of `.kbth-page`, `[data-kb=ld-picker]` and `[data-kb=ld-pack]` and
  computes the WCAG ratio from the computed colour over the first opaque background ancestor; any text
  under 4.5:1 fails the check. The selector list of the plugin's « small texts in Light » rule is read
  from `client.js` itself (so a new selector is measured without editing the test); each one must have
  been on screen at least once, and in Dark it must still compute DSH's tertiary or caption colour (the
  rule is inert there). The « Aa » samples of the contrast table are skipped: both of their colours are
  the pair under test, set inline from the plugin's own model. Everything else is exercised in Dark
  only. Light screenshots (`kb-theme-light-{essentiel,verre,animation,picker,pack,access}.png`) go to
  the OS temp folder (paths printed).
- Under an English interface the `french` section reads each tab (and the picker's three tabs, the word
  pack, the ambiance list, the settings disclosure) with the same collector as
  `audit-i18n-live.mjs --baseline`, re-reading each view until nothing changes any more, and **fails**
  on any French left except the export's file content (its YAML header comment is the file's own text).
  The two live translators (`kybernos-plugin` `passe()`, `kybernos-language` `LIVE_ROOTS`) run on timers, which
  the throw-away headless Chrome sometimes has throttled for seconds: before reading a view the check adds a canary
  text (« Copier ») and waits until it reads « Copy », so a late translation is not mistaken for a missing one. A
  string that is French in a window's `aria-label` shows up here but not on screen: it is a leftover.
- Several agents may share one DSH: another session switching the real GUI to Light during the
  run is caught by the mode guard above, and is not a failure of the page. A switch of DSH's
  *language* reloads every open page and flips labels mid-run: each section compares `<html lang>` at its
  start and end and prints `! the interface language changed…` — read the failures of that section as invalid.

## The Team surfaces, read-only: `scripts/check-team-live.mjs`

```bash
node scripts/check-team-live.mjs --shots /tmp/shots      # + screenshots of the menu, the iframe, Members, Providers
node scripts/check-team-live.mjs --capture-labels        # re-freeze the label baseline (see below)
node scripts/check-team-live.mjs --console-file <path>/workspace-console.html   # test the console you are editing
```

It writes nothing: no setting, no key, no language, and DSH is not restarted. It opens the account menu, opens
« Teams settings », reads the iframe, then loads the hosted console (the iframe's own address) in the throw-away Chrome
at the iframe's width and reads each of its pages (the list comes from the page, not from the script).

- **menu**: the entry exists; it opens the console in an iframe whose URL carries the gateway and DSH's theme and **no key**;
  the iframe fills the content area; an outside caller (no `Origin`, or a foreign one) gets 403 from
  `/kybernos/ws-console-key`. The key itself is never read by the script: only whether the host has one.
- **console**: every page opens without a script error, shows no `undefined` / `NaN`, and has no element wider than its
  column. The Members table is 101 px too wide today, so this check is red until that is fixed.
- **labels**: `scripts/team-console-labels.json` freezes the static labels of each page (headings, buttons, tabs,
  columns, field labels, helper lines; no numbers, no names). A rework may not lose one silently: a label that is meant
  to go is listed in `allowRemoved` with the owner's approval. The baseline does not protect sentences outside those
  elements. Re-freeze with `--capture-labels` only on a console you trust.

- **bridge** (only with `--console-file`): the file is served on a free local port instead of reading the hosted console; after
  the page-by-page reading it is loaded **with a key** against `scripts/lib-fake-team-gateway.mjs`, a stand-in for the gateway
  and the team API that answers with the shapes the real services return (read-only). It proves the console's data bridge still
  turns those answers into the right screens: the team's id and creation date, the plan and balance, the two members and the
  side panel, Kybernos as one provider card then the team's own, the models, the usage total, the Stripe invoice. When the
  console is rewired to other routes, change the stand-in's table: a drift there is the test doing its job. Run it on the
  previous console file and it fails (10 checks), which is how you know it is not vacuous.

- **relay** (only with `--console-file`): the console the way DSH runs it, with no key anywhere. `scripts/lib-fake-relay-host.mjs`
  serves a host page holding the console in an iframe, with **the broker cut out of `packages/kybernos-plugin/client.js`** (what
  ships, not a copy) and a `/kybernos-cloud/relay` route that applies **the real allowlist, `relayCheck()` of
  `packages/kybernos-cloud/index.js`**, then answers with main-API and LLM-service shapes. It proves the console announces itself,
  asks only for paths the allowlist names (a path outside it is listed and fails the check), calls no gateway of its own, names
  the signed-in person from `/v1/me` and shows other members as a short id rather than an invented name, refuses a write and an
  unknown route in the page, and says « Sign in » when the host is not connected. One thing is stand-in: the page and the console
  share an origin so the test can read the iframe; the origin check itself is `packages/kybernos-plugin/test-console-broker.mjs`.

Every dialog or side panel a page owns is opened and read (Plan: Compare plans; Members: a member's details and the filters;
Usage: the filters), the segments that swap a view are pressed (Usage: group by), and every inner tab is checked for overflow,
so a label that moved behind a click still counts as reachable and nothing hides a table wider than its column.

Printed, never failing: whether the host has an admin key (without one the console shows **demo data**), the number of
controls and the scroll height of each page. The count is one rule for the console and for any mockup (visible fields plus
the outermost clickable elements), so a before / after comparison is fair.

Needs the network (the console is hosted) and a connected account; exit 3 when either is missing.

The host half of the key hand-off is unit-tested in `packages/kybernos-plugin/test-ws-console-key.mjs` (who may ask, what the
answer carries, where the page posts it). The cloud client's React render half runs only where `react` and `react-dom`
resolve (`NODE_PATH=<a node_modules with them> node packages/kybernos-cloud/test-cloud-client.mjs`); CI has none, so it
skips there: run it by hand after touching the footer card or the account menu.

## Translation coverage: `scripts/audit-i18n-live.mjs`

```bash
node scripts/audit-i18n-live.mjs                    # a real translated language: ar (RTL)
node scripts/audit-i18n-live.mjs --lang es          # another language
node scripts/audit-i18n-live.mjs --baseline         # the GUI as it is now, no language switch
node scripts/audit-i18n-live.mjs --json out.json    # + the full machine-readable report
```

A real translation needs an LLM and proves nothing about *coverage*: a string the
system never asks for is simply left alone. The audit therefore builds the language
with the **stubbed model** (every string returned as `⟦text⟧`) through the real page
and engine, then walks the main views, the account menu and every settings section
by real clicks and reads what is visible:

- text carrying `⟦…⟧` went through the translation system;
- text without it is a **leftover**: `FR left` is French nobody translated
  (hardcoded in a plugin, or a plugin with its own table), `EN left` is English
  from DSH itself, or data (session titles, kyber descriptions, workspace names).

It runs two passes: the first lets the live translation of hardcoded settings text
learn each page, the audit waits for that to settle, the second measures.
`--baseline` is safe at any time (it switches nothing); the other modes follow the
language-preference rules above. The sidebar's session list is left out (titles the
user wrote are data, not copy). Exit code is `0` (it measures, it does not gate),
`3` when inconclusive.

## An isolated instance for host code: `scripts/sandbox/`

A host half (`packages/*/index.js`) only loads when DSH starts, and a restart interrupts the sessions running in
your real DSH. To see host code live, run a **second** `dsh web` with its own HOME and DSH_HOME that serves *this
checkout's* `packages/*`:

```bash
scripts/sandbox/start.sh                 # first run clones the real profile (read only), re-points every @local link at this checkout, starts on 3098
source scripts/sandbox/env.sh            # HOME, DSH_HOME, KB_HOST, DSH_WEB_PORT now point at the sandbox (kb_sandbox_leave undoes it)
node scripts/check-connectors-live.mjs --write --shots /path/to/shots
scripts/sandbox/stop.sh                  # kills only the pid it recorded, after checking it is the sandbox's dsh
```

- It reads your real `~/.dsh` (clone of `profiles/web`, copy of `mcp/`) and never writes there, never copies a
  credential, never uses port 3080 (a busy port makes it take the next free one) and refuses to run with the real
  HOME. State lives in `~/.kybernos-sandbox/<checkout name>` (`KB_SANDBOX_ROOT` overrides): short on purpose, a unix
  socket path is limited to about 100 characters.
- Client edits (`client.js`) are served from the checkout at once; host edits need `stop.sh` then `start.sh` (this
  instance holds nobody's sessions). `setup.sh` again after the checkout gains a package, `setup.sh --refresh`
  (sandbox stopped) to re-clone the profile.
- `sandbox.log` holds DSH's token URL: never print it; sign in with the cookie like every script here.
- A fresh instance asks for a model key in a dialog that covers the page (it swallows mouse events): click
  "Configure later" first, as `check-connectors-live.mjs` does. The paid module `@local/kybernos-servers` is read
  from its private checkout when there is one.
- With DSH_HOME alone the sandbox would write the real profile: several bundles hard-code `homedir()`, so HOME is
  isolated too.

## The Connectors page: `scripts/check-connectors-live.mjs`

```bash
node scripts/check-connectors-live.mjs [--shots <dir>]    # read only, safe on the real DSH once its host has the new routes
KB_HOST=... node scripts/check-connectors-live.mjs --write # the whole life of an MCP server, on an isolated instance
```

Read only: the three tabs, the add menu, row actions hidden until hover, a state chip on every row, the form
opening on a server the skill wrote. `--write` adds a fake stdio MCP server by pasting JSON, waits for DSH to load
it by itself (hot reload, no restart), tests it, switches it off and on, renames it and deletes it; it **refuses to
run against 127.0.0.1:3080** unless `--allow-real` (it writes the profile and the `.env`). Exit 0 / 1 / 3
(inconclusive).

## The Workers page: `scripts/test-workers-gui.mjs` and `scripts/check-workers-live.mjs`

Two checks, two jobs. `test-workers-gui.mjs` plays the **real client** in Chromium against the **real host routes** over a faked
world (binaries, sign-in, git, installer and credentials store are toggles), so install, activation, key and policy flows run
without touching anything. It needs Playwright and React 18 UMD builds, which this repo does not install: point
`KB_BENCH_DEPS` at a folder whose `node_modules` holds `playwright`, `react@18` and `react-dom@18` (symlinks are enough), and
`KB_CHROMIUM` at a browser when Playwright's own is not downloaded. Without them it exits 0 "SKIPPED".

```bash
KB_BENCH_DEPS=/some/dir KB_CHROMIUM=/path/to/chromium node scripts/test-workers-gui.mjs --shots /tmp/shots
source scripts/sandbox/env.sh && node scripts/check-workers-live.mjs --shots /tmp/shots   # the real GUI, on a sandbox instance
```

`check-workers-live.mjs` opens Settings → Workers in the sandbox, with the real programs of the machine: seven rows, logos, the
columns lining up, *Check all* (spends nothing), the key field (and whether the engine offers the credentials service), the
guide from the Suite's help card, Escape closing the guide and not Settings. It **never installs, never types a key, never saves
a policy** — the install button is only ever clicked in the faked world of the first script. The sandbox has none of the
user's credentials, so every agent that needs a sign-in reads "To connect" there: that is the expected result.

## Kybernos connections: `scripts/check-connections-live.mjs`

```bash
source scripts/sandbox/env.sh && scripts/sandbox/start.sh     # an isolated instance serving this checkout
node scripts/check-connections-live.mjs [--shots <dir>]
```

The « Kybernos connections » mode of the Connectors page against a **stand-in server that speaks ADR 0008 of the Kybernos
server** (the real one is not built yet). It writes into the isolated instance only (a server entry whose
`services.connections` points at the stand-in, and a connection file with a made-up token; both are put back) and **refuses
to run against 127.0.0.1:3080 or without an isolated `DSH_HOME`**. The host half is read at start: restart the sandbox after a
host edit. It plays: the mode switch only when the server offers connections, the list with its states and the quota, the add
window paging a 105-app catalogue (48, 96, 105; a search starts again from the first page), row
actions hidden until hover, a pending connection that turns active by itself, adding an OAuth app (what the stand-in
receives, and nothing else), adding an app with an API key (the key reaches the stand-in once and is on no later call, on
the page or in the browser's storage), a refused add that may have gone through (one call, then « check the list »), a
second request for an app that is already waiting, removing, the quota, the sign-in shown when the account is not connected
(and the new token used afterwards) and the mode gone when the server stops offering it. Exit 0 / 1 / 3.

## Traps

- **These scripts are deliberately NOT named `test-*.mjs`.** CI runs every
  `scripts/test-*.mjs` on a runner with no `dsh web`: a live script named that way would
  exit 3 ("inconclusive") there and fail the build. Live checks are `check-*` / `audit-*`,
  run by hand; the offline tests stay `test-*`.

- **Host code is not hot-reloaded.** A change in `packages/*/index.js` or in an
  `.mjs` the host imports (e.g. `i18n-translate.mjs`) needs `dsh web` restarted. A
  change in `client.js` only needs a page reload — the profile links `packages/*`
  by symlink, so the GUI serves the working tree.
- **The account footer shows a workspace name that changes** between profiles
  ("My workspace", "dee"…): never click it by text.
- **Labels change with the language and between releases.** Under a translated UI
  the sidebar says « Créations » or « Livrables », never "Creations": pass
  aliases, click by position, or use the `data-*` hooks.
- **« Language » is also a row of the General page** under a translated UI: click the
  settings nav entry (« Langue ») first.
- **DSH can be slow to read its stored language.** Until it has, it sits on a
  provisional language (the browser's). The runtime in the core therefore waits for the
  read to finish (up to 30 s) before it follows DSH, and never acts on an English it cannot
  tell from that default; the unit test `test-lang-runtime.mjs` pins it with a fake slow
  host. A busy machine (a second test run, another session) is what exposes it.
- **Do not click inside the settings from the settings.** The account footer is not
  there: start from a clean page (`flow.openSettings` reloads first).
- A 401 from your script, with a valid cookie, usually means the *authority* is
  wrong (`KB_HOST` must be exactly `host:port` as `dsh web` listens).
- **The Theme page and the Language page share the `kbth-` class prefix.** `.kbth-page` is true on both: a test that asks
  « is the Language page shown? » must use `[data-kb="language-page"]` or `[data-act="add-language"]`. (A first version of the
  ring's click handler stopped at « the page is already there » while Settings still showed Theme.)
- **A click on a position hits what is on top.** With Settings open, the sidebar footer is covered by the nav: clicking the
  ring's coordinates selected « Theme ». Close Settings with a real click on « Back to workspace » first, and check it closed.
