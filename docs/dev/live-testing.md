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
| **Signed session cookie** | derived from the *persistent* secret `client-connection/browser-session` in `~/.dsh/.credentials.yaml` | 24 h, and it survives restarts | scripts and automated tests |

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

## The Theme page, end to end: `scripts/check-theme-live.mjs`

```bash
node scripts/check-theme-live.mjs --shots /tmp/shots      # screenshots of the main steps
node scripts/check-theme-live.mjs --only skins,persist    # just those sections (the baseline always runs)
```

Nothing is stubbed: the page, real CDP mouse and key events, DSH's theme service, the token
layer, the wallpaper `<div>`, the font style tag, the `kybernos.theme.v1` store and the reload at
boot are all real, and the assertions read **computed styles** (the 17 `--dsw-*` tokens on
`<body>`, the wallpaper's `opacity`/`filter`, `--dsw-font-family`), never the source. It checks:
the page and its controls; every dark and mode-less theme (stored, tokens equal to the pack's
palette, wallpaper, pill) and « DSH default » giving back the 17 native values; persistence (a
reload applies theme, accent, wallpaper, font and text size **before Settings is opened**);
accent dots, hex field (invalid input marks `.bad` and changes nothing), picker and reset;
wallpaper categories, tiles, visibility / blur / tint, and whether it can actually be *seen*;
the font selector (search without accents, arrows, Enter, Escape, click outside); the eight
Advanced sub-tabs; Colors (what the page shows equals the applied tokens, token editor and its
reset); Accessibility (contrast levels measured as WCAG ratios); « Reset all »; Sharing
(export, copy, import). A console error from `[kybernos-theme]` or an uncaught exception from
one of its functions fails the section it happened in (a second CDP connection listens).
Exit code 0 / 1 / 3 (3 = no Chrome, no GUI, the Theme page unreachable, before any measure).

Besides ✓ / ✗ it prints two blocks that are **not failures**: *KNOWN GAPS* — every Advanced
control that calls `commit({ key })` with a key outside `DEF` is measured (stored in
localStorage? restored after a reload? any change of the DOM?), plus the export / import
limits — and *OBSERVATIONS*. A ✗ is a real defect: the check stays red until it is fixed.

### ⚠ A theme can persist DSH's mode and font size — on your machine

The plugin drives DSH's own theme service: every change calls `setTheme(mode)` and
`setFontSize(px)`, which DSH stores in the profile (`ui-theme` in `cordis.patch.yml`), not in the
throw-away browser. And a **boot** with no Theme state re-applies the default size, 15, over
DSH's own. So the script:

1. reads that file before it starts, and uses the stored mode as the one to keep;
2. clicks only Dark and mode-less themes while that mode is Dark (only mode-less ones otherwise,
   and it then skips « DSH default » and « Reset all », which force Dark); it never clicks a Light
   theme, never uses « Surprise me », never touches the Mode buttons except to restore;
3. before **every** click, key or colour pick, checks that DSH still reports that mode
   (`html[data-ds-theme-source]`): if it moved — even by someone else — the run stops at once
   and puts it back;
4. moves the text size by +1 px for a few seconds and ends by putting back the size it found;
5. in a `finally` (and on SIGINT / SIGTERM) verifies both values in the file, restores them
   if needed and prints `!!! NOT RESTORED` if it cannot. A hard kill can still leave them moved:
   set the mode in Settings › Theme and the size with the text-size slider.

### Hooks and traps

- Hooks are classes: `.kbth-skin`, `.kbth-dots .kbth-dot`, `.kbth-cat`, `.kbth-wp`, `.kbth-fsbtn` /
  `.kbth-fssearch` / `.kbth-fsopt`, `.kbth-adv-tab`, `.kbth-adv-pane`, `.kbth-tok`,
  `.kbth-adv-editor`, `.kbth-foot`. A slider has no id: find its `.kbth-sl` block by label (either
  language). The Mode row is the segment reading System / Light / Dark.
- Sliders are driven with real `Home` / `End` / arrow keys on the focused range input (exact and
  deterministic); colour pickers by the native value setter plus an `input` event.
- **`Escape` closes the whole Settings dialog**, font panel open or not. The check that wants it
  to close only the panel is red for that reason.
- The wallpaper `<div>` has `pointer-events: none`, so `elementsFromPoint` never lists it: to
  know whether it is visible, look for an opaque element *above* each sampled point instead.
- Tokens are read on `<body>` (that is where DSH and the layer declare them), not on `<html>`.
- Only the Dark half of each `{ light, dark }` pair is exercised end to end; the Light half is
  checked only through what the page displays, because the run must not switch DSH to Light.
- Several agents may share one DSH: another session switching the real GUI to Light during the
  run is caught by the mode guard above, and is not a failure of the page.

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
