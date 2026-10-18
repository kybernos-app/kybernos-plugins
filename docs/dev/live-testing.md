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
- **Settings is an accordion.** Our pages sit in eight groups, one open at a time, and a hidden cell cannot take a real mouse click.
  `openSettings(page)` draws every page for you (`data-kb-all-pages` on `<html>`, in the throw-away browser only: nothing of your DSH changes);
  pass `{ fold: 'keep' }` to leave the menu as it is (the check of the accordion itself does). A script that clicks the cell with `cell.click()`
  reaches a page either way, and landing on a page inside a group opens that group, as it does for a person. To try a change of the core plugin's
  client before it is merged, `check-settings-nav-live.mjs --worktree` and `check-settings-search-live.mjs --worktree` serve this checkout's client in
  the throw-away browser (`scripts/lib-bundle-swap.mjs`).
- **Never read the menu once after a fixed delay.** Plugins add and retitle Settings cells a moment after the dialog opens, and a busy machine only
  makes that moment longer. `goToSettingsPage(page, label|RegExp, { marker })` waits for the cell, presses it and waits for the page's own marker (a
  JS expression), pressing again when the press was lost to a redraw; `openSettings(page, { tries })` does the same for the dialog itself. A check
  that sleeps 1.5 s and reads once is a check that is red under load for no product reason (R3-06).
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

The two resume checks (after a failure half-way, and an older installation that holds the Kybernos tables only) hold no
constant about the size of the corpus, which grows with every bundle and every DSH version (DSH's own dictionaries are about
half of it): they compare what the run **sent** with what the row says is **left** (`total − kept`), and fail if any text
the language already held went out again. The stub keeps the wire names of every batch (`__KB_TEST__.batches[].keys`) for that,
and a run's own batches (`source: 'fr'`) are told apart from the live layer's (`source: 'auto'`).
On a **fresh sandbox** two checks read ✗ by design, « the account menu … is translated live » and « the chat and session
titles are never touched »: they need a signed-in account and existing chats, which a sandbox does not have.

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
place showing in the other.

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

On a **sandbox** (`KB_HOST` is not `:3080`) the checkout `dsh web` serves is the one the sandbox was built from, `KB_WORKTREE`, not the
main tree: the helper looks for that tree's text, so the swap reports `replaced: true` there (the page already runs this client).
`KB_SHARED_TREE` / `KB_SERVED_TREE` override it.

## The Skills panels: `scripts/check-skills-detail-live.mjs`

```bash
node scripts/check-skills-detail-live.mjs --shots /tmp/shots
```

On the REAL GUI (`:3080`) and the user's real skills, read-only: this checkout's client of `kybernos-skills` is swapped into the
page, and the two routes the running host does not have yet (`skill/read`, `preview`) are answered by this checkout's host code run
in the script (the real folders, then GitHub anonymously). Every other non-GET request to `/kybernos-skills/*` is answered inside
the check and recorded, so nothing the page does can write, install, delete or open anything. It checks that a Yours card opens a
panel beside the list with the SKILL.md exactly as it is on disk, the actions the skill allows, that Delete and Install open their
confirmations (and only ever get Cancel), that two Discover cards have their own repository, folder and text, the publisher by
repository, and the layout at 900 px.

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
page load. DSH's own « Get started » dialog (sign in to a DeepSeek account / add an API key) no longer opens: the core replaces that step
(`settings.onboarding` › `deepseek-official`), and `live-page.mjs` still presses its Close cross on an engine that shows it. A chat for a git folder only exists once a first message
was sent (the turn then fails for lack of a key, which is fine): `check-changes-live.mjs` does both by itself.

## The new-chat page: `scripts/check-newchat-live.mjs`

```bash
node scripts/check-newchat-live.mjs --shots /tmp/shots
```

It runs against the real `:3080` and swaps the `kybernos-plugin` client for this checkout's (`lib-bundle-swap.mjs`, throw-away Chrome: the
shared tree is untouched, no restart). It reads the blank chat (slider under the composer, one colour, the drawings, the arrows, the
Cloud Computer line) and types in the composer: **a draft is typed and cleared, nothing is sent**, and the draft lives in the throw-away
browser (the last check reloads the page and reads an empty composer). Exit 3 when there is no blank chat on screen or the shared tree
has uncommitted edits of the plugin client (the swap would not match). Two traps it met: `scrollIntoView` on a `scroll-snap`
track ends on a snap point, not where asked (bring the chapter to the start instead); and the editor is cleared with the select-all
key *command*, not `execCommand`.

## The face of cards, rows, headers and the Marketplace: `scripts/check-cardface-live.mjs`

```bash
node scripts/check-cardface-live.mjs --shots /tmp/shots
```

Real `:3080`, read-only: it swaps the `kybernos-plugin` client for this checkout's (`lib-bundle-swap.mjs`, throw-away Chrome), opens
Workspaces then Agent Teams and measures the card face (tile without outline, glyph colour, watermark hidden at rest / shown on hover /
not moving, the word of a figure on hover, the actions in the foot, no empty-description line, the toolbar still there). It then presses the
list toggle (stored in the throw-away browser only) and measures the rows (tile 34, figure columns on the same x, actions on hover, no pill,
no placeholder line), opens a team and a project (header tile 56, the figures under the team's name, the avatar preview 96, the chosen icon in
colour), then the Marketplace: cards, the Preview dialog, rows, and the kybernos.app catalogue, which answers nothing on this machine: the
browser, and only that browser, is told by an in-page `fetch` stub that it holds two entries (reading only; Install is never pressed). The pages
that matter are also measured in a 400 px window. Exit 3 when no card is on screen or the shared tree has uncommitted edits of the plugin
client. `check-cards-live.mjs` (sandbox only) still measures heights.

## The account menu: `scripts/check-account-menu-live.mjs`

```bash
node scripts/check-account-menu-live.mjs --shots /tmp/shots
```

Real `:3080`, read-only: it swaps the `kybernos-cloud` client for this checkout's (`lib-bundle-swap.mjs`, throw-away Chrome), opens the account card at the
foot of the sidebar and measures the menu: every label 13 px in one font (500, the name of a space 600), the small lines 11.5 px, the text of every row
on the same x (one icon column of 28 px), rows of 36 px or less, no label cut by an ellipsis, separators of 10 px, the whole menu 600 px or less. No entry
is pressed (the Appearance segment would change the theme). Exit 3 without a signed-in footer card or when the shared tree has uncommitted edits of the cloud client.

## The Changes chip: `scripts/check-changes-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-changes-live.mjs --shots /tmp/shots
```

It refuses to run against `:3080` (exit 3: that DSH does not load the bundle). It checks the real data path (the chip, the
host's `fichiers`, the four pills stepping aside), every state through the seam, an action end to end, French, a narrow
window and the seam missing. **Every POST of `/kybernos-sessions/*` is answered inside the page by the check** (fail-closed):
the sandbox runs git in the user's real repository folder, so a real commit must be impossible, whatever the page asks.

## The Usage plugin: `scripts/check-usage-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-usage-live.mjs --shots /tmp/shots
```

Sandbox only (exit 3 against `:3080`). It reports six sessions through the real `/kybernos-usage/observe` route (own key, local
model, Kybernos model) and checks the booking (a first sight is a baseline, the next report a delta on today, the plan model
kept apart), then opens Settings › Usage and checks the plan block (not signed in), the by-model and by-session lists, the
period switch, the budget saved through the real route, a 390 px window and the absence of console errors. The chip is only
checked to stay absent: a sandbox has no key, so no turn and no `tokenUsage`; the chip drawn from a real turn is seen once on a
keyed machine. The only thing written is the sandbox's own usage ledger.

## The Dashboards plugin: `scripts/check-dashboards-live.mjs` and `scripts/check-dashboards-render.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-dashboards-live.mjs --shots /tmp/shots
```

Sandbox only (exit 3 against `:3080`; `setup.sh` adds the bundle to the cloned profile). In the real page it checks the host
routes through the page's own origin, the **Dashboards** row of the Kybernos menu (it must sit right before Agent Teams and
open the page the bundle provides), the gallery and a preset drawn with this DSH's real data, that the entrance animations
exist and finish, and the right-pane tab: a dashboard filed under the chat on screen
(`POST /kybernos-dashboards/open {id, session}`, the session being `window.__KB_DASHBOARDS__.session()`) opens the tab by
itself; a note is typed with real editing commands (Enter makes `<div>` in a contenteditable) and must be saved and shown as lines; the flow preset must draw a live number on every node, placed apart. The pane check runs first on purpose: the tab only shows inside a chat, and the menu step leaves the chat. A sandbox has
no key and no automations, so the widgets show their empty states; the agent writing through its tool during a real
conversation is not played here (it needs a model). The only thing written is the sandbox's own dashboards folder.

```bash
KB_NODE_MODULES=<a node_modules with react, react-dom, esbuild, playwright-core> node scripts/check-dashboards-render.mjs
```

Needs no DSH at all: it bundles React, loads the built `client.js` in headless Chromium and answers the page's `fetch` from
the real host logic (a temp folder) and fixture answers for the other bundles' routes. It plays what a sandbox cannot:
screenshots in light, dark, a 480 px pane and a phone; the motion (a rise per bar, a card counting up, every animation of a
visible widget finishing, nothing moving under reduced motion); editing (a widened widget, a note, a colour, a kanban card
become revisions by the person); and the agent's tool writing while the page is open (the page picks it up and flashes the
widget). Four traps met: `fill()` of Playwright sets the text without any Enter, so a note test must type with the keyboard (`textContent` glues the lines of a contenteditable); an SVG node carrying both a `transform` attribute and a CSS-animated transform loses its position (put the position on an outer group); a full-page screenshot enlarges the viewport, so the page must be walked first or the widgets below the
fold are still at their start frame; and a loaded machine (a test loop running beside it) slows the animations, so it waits for
them to finish instead of sleeping.

## The language of the creation surfaces: `scripts/check-language-creation-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-language-creation-live.mjs --shots /tmp/shots [--langs en,kybernos,es,ar]
```

Sandbox only (exit 3 against `:3080`). It never touches DSH's stored language: the language of Kybernos is set in the throw-away
browser (`localStorage['kybernos.theme.lang']`, the key the Language page writes: `en` removes it, `kybernos` is the French of
Kybernos, `es` and `ar` are translated languages that have no table of ours), the page is reloaded, and for each language it reads the
right-sidebar start list, the panels Bricks, Slides, 3D modeller, Summary, Motion and Dashboard, the sidebar's « Search everywhere » row,
the composer's « where it runs » menu, the phone layout's menu button, and the Atlas page with its help. English, Spanish and Arabic must
read English; French must read French; no French word in another language, no English phrase of ours in French. The sandbox keeps its
right pane (and its tabs) from one run to the next: the check asks for a fresh start list. In a right-to-left language the right pane is
drawn on the left of the window. The offline twin is `scripts/test-no-french-literals.mjs`: French literals outside a dictionary, the
pair helper (`kt(fr, en)`: French for French, English for everything else), READMEs and descriptions, the French twin that must stay.
A bundle listed under `"unaccented"` in `scripts/i18n-french-allow.json` is also read for French typed without its accent (« indisponible »,
« Discuter »): the gate used to count accented French only, so error messages, log lines and labels written on a keyboard without é got through.
The live twin of that reading is `node scripts/audit-i18n-live.mjs --baseline`: in English the « FR left » column must be 0 (the language picker's
« Français » is the one allowed word).

## The first-run wizard: `scripts/check-onboarding-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-onboarding-live.mjs
```

Sandbox only (it refuses `:3080`, exit 3): it really saves a key and connects a model, which is the point, so it must write to
an instance that is nobody's. It writes `completed:false` in the sandbox's `kybernos/onboarding.json` itself (`setup.sh` writes
it as done), walks the screens, and answers three things over CDP so that nothing leaves the machine or runs for real: the Kybernos
Cloud pairing routes, the key check (a provider's API is never asked about a made-up key) and the installer with its progress
(no `brew`, no `ollama pull`). What it reads or writes for real: the host's onboarding route and file, the machine probe, and
both seams (`window.__KB_MODELS__`, `window.__KB_LOCAL__`): the credential and the provider routes land in the sandbox's
`.credentials.yaml` and `cordis.patch.yml`, checked by name, never by value. The check also reads the profile's default model
(the `agent-default-model` entry of `cordis.patch.yml`) to see that connecting a way switched it, and restores the credentials
and the patch it started from (it waits ~7 s after each restore: the profile hot-reloads). Host code changed since the sandbox started: `stop.sh`, `start.sh`.

It also plays the free-account offer: the offer comes after the display mode, « Use my own model instead » reaches the model
screen, Cancel of the pairing returns to the offer, and an account of a plan with no model (the stand-in poll answers
`models.count: 0`) leads to the free models' acknowledgement; nothing is wired before the box is ticked, then the host is asked
(`/free-llms/auto-enable`, answered by the check: the real route would call a third party) and a free model is made the default.
The sandbox is left as it was found, with one exception that is the point: `kybernos/onboarding.json` is put back as a **finished** first run
(`completed:true`) even when the file the run started from said otherwise (a run killed hard leaves the wizard open; the next run must not
take that for the sandbox's own state, because every other live check then meets the wizard over the page). The agent teams the starter kit
installs are removed before and after, the verdict line is printed in a `finally` (and for a signal or an uncaught exception), and the kit's
rows are read only once the one this check installed (`pdf`) is marked as done, i.e. after the kit has read what is installed.
Two things the sandbox imposes: the profile it was cloned from may already default to a model that works without a key (the free
models), so the check first replaces such a default by a route of the profile whose key the sandbox lacks; and a profile write
can be refused (`write_refused`) while the engine reloads, which is why the wizard asks again a few seconds later.

## The help of every plugin: `scripts/check-help-live.mjs`

Each bundle has a `packages/<dir>/help.json` (what it is, how to use it, where to find it, one thing worth knowing, in French and
English). `scripts/build-catalog.mjs` validates it and ships it in the catalogue; the Suite shows it on the module's page, and the
« ? How it works » button of a plugin page (`window.__KB_HELP__.Help`, published by the hub) shows the same text.

```bash
node scripts/test-help.mjs                   # no GUI: the shape, every bundle has one, the buttons are guarded and ask for their own bundle
KB_HELP_SITE=<kybernos-help>/dist-site node scripts/test-help.mjs   # ...and each card's article link is an article the help site really has
source scripts/sandbox/env.sh && node scripts/check-help-live.mjs --shots /tmp/shots
```

The live check opens each page that carries the button (Theme, AI Provider & Models, Commands, Workers, About, Ollama Local Models,
Memory & Lessons, General, Kybernos Suite, Skills), opens the card, checks it holds the text **read from the file**, that Escape closes
the card and not the Settings dialog behind it, then French, a module's page in the Suite, and that Atlas, Language and Auto Routing
(which already had a help) do not get a second button. Two traps: the Settings dialog closes on Escape with a capture listener, so
anything that handles Escape inside it must listen in capture and stop the event only when it has something to close; and the core
rewrites French phrases to English on Settings pages while the document language is English (a French test must set
`document.documentElement.lang` too, or compare without quotation marks).

### The article link, the animation of the first visit, one button: `scripts/check-help-intro-live.mjs`

Three things ride on the same hub seam (`window.__KB_HELP__`):

- **The article.** `help.json` may carry `"url"`: an address on `help.kybernos.app` (`build-catalog.mjs` refuses any other host).
  `{lang}` as the first part of the path stands for the reader's language (en, fr, ar, zh-cn; any other gets English), the way the
  site addresses its articles: `https://help.kybernos.app/{lang}/<category>/<article>/`. The card shows it as « Read the article »
  at its foot, in a new tab with `noopener`; the Suite's module page too. A bundle with no article yet simply has no `url`: nothing is drawn.
  The host shows the shipped card, link included, whatever the signed catalogue says, so a link needs no release to appear.
- **The animation of the first visit** (`window.__KB_HELP__.Intro`, the mechanism of the Language page for any page). A page draws it
  under its header with the words of its own screen: `h(Intro, { id, title, caption, steps: [{ t, b } × 3], mock: { bar, rows,
  hot, states: [3], actions: [3], done } })`. The mock is CSS only (12 s loop; its base style is the end of the story, which is what
  `prefers-reduced-motion` shows). It opens until the person closes it (✕, remembered as `closed`) or it has been on screen for 8 s
  once (`seen`): the first visit, then never by itself. The card of the page's button offers « Watch the animation » to bring it back.
  The key is the one of the page's button (`kybernos.help.intro.<id>`, in this browser's localStorage). Skills, Connectors and Remote
  Control have one; adding a page is one call and its strings.
- **One « ? How it works » button.** The Suite's pill is the only form. The pages that draw their own copy it declaration for
  declaration (the core's Agent Teams / Automations button `kb6-helpbtn`, the Calls tabs `kbcl-hl`, Language `kbln-help-btn`, Atlas
  `kbat-help`; each keeps the panel it opens): `scripts/test-help.mjs` compares them.

```bash
node packages/kybernos-hub/test-help-card.mjs   # no GUI: the link, the card's side, the animation's state and timer, the host's merge
source scripts/sandbox/env.sh && node scripts/check-help-intro-live.mjs --shots /tmp/shots
```

The live check starts from a throw-away browser, so its empty localStorage **is** the first visit: it checks the animation opens
on Skills, Connectors and Remote Control, runs (CSS animations counted; the three steps light in turn, sampled on the loop's own
clock, not the test's), is marked `seen` after 8 s and does not come back, comes back from the card, and closes for good; the
article links; one button of the same size and shape on sixteen pages (among them the ones whose own CSS restyles every button); reduced motion (no animation at all, the end of the story
shown); the lines that say what Usage, Tools, Workers and Commands are for; and French on Remote Control.
Two traps: the first click on a sidebar entry right after the shell loaded can open nothing (the check clicks again until the page's
own text is there), and the page behind the Settings dialog stays in the document, so a button is counted only where it is the
topmost element (`elementFromPoint`).

## The Agent presets button and the Ollama search: `check-creator-draft-live.mjs`, `check-ollama-search-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-creator-draft-live.mjs [--shots /tmp/shots]
source scripts/sandbox/env.sh && node scripts/check-ollama-search-live.mjs [--shots /tmp/shots]
```

Both need a sandbox that serves this checkout and refuse `:3080`; neither writes anything.

- **`check-creator-draft-live.mjs`**: « Let the agent help me create a preset » (Settings › Agent presets) must land in a Creator-mode
  chat with the brief already in the composer and Settings closed. DSH ships that button with no draft (`startSession` with
  `agentPreset: 'cordis'` and no `prompt`); the client hands that exact call a prompt
  (`packages/kybernos-plugin/test-creator-draft.mjs` pins the call shape without a browser). The draft is never sent.
- **`check-ollama-search-live.mjs`**: « Search for new models » runs installed models → this machine → the catalogue, names the one
  that is running, answers, and the page always says where its list comes from. The sandbox has no catalogue key, so the honest
  answer is « not active yet »; the signed path is played against a local server by
  `packages/kybernos-modeles-locaux/test-modeles-catalogue.mjs`. Trap: the button is in the machine tile, which is drawn only
  once the machine is measured (a few seconds when Ollama is installed but not serving): wait for it.

## The Study model: `scripts/check-study-model-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-study-model-live.mjs [--shots /tmp/shots]
```

Kybernos Settings has ONE brain row, the Study model (« Decision Brain » is gone): Automatic — <model> (the empty setting, the
default), « Choose another… » and None. The check refuses `:3080`, picks each state in the page, reads what the host kept and
what the decision route does (None: nothing is sent to any model, the word rules still pick the icon), and puts the sandbox back on
Automatic. It calls no model. The closed question itself is played by `packages/kybernos-sessions/test-decision-llm.mjs` (a stub
`llm`); to see it through DSH's real `llm` service in a sandbox, point the sandbox's `ollama-local` route (its own
`cordis.patch.yml`, hot-reloaded) at a local fake OpenAI-compatible server and put `OLLAMA_LOCAL_API_KEY=ollama` in the sandbox's
`$DSH_HOME/.env` (read at launch: restart the sandbox). Trap: a plugin's host half sees a service with `ctx.get` only when it
declared it; the sessions bundle reads `credentials` from `ctx.root` (until it did, every provider looked connected, and the Cloud
was picked on a sandbox with no account).

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
the page (no Simple/Advanced switch: eight vertical tabs, « Essentiel » open after every load)
and its controls; every dark and mode-less theme (stored, tokens equal to the pack's
palette, wallpaper, pill) and « DSH default » giving back the 17 native values; persistence (a
reload applies theme, accent, wallpaper, font and DSH's text size **before Settings is opened**);
accent dots (a near-invisible accent is lightened to 3:1), hex field (invalid input marks `.bad`
and changes nothing), picker and reset; wallpaper categories, the « None » tile, tiles, visibility
/ blur / tint, and whether it can actually be *seen*; the font selector (search without accents,
arrows, Enter, Escape, click outside) and the text size; the eight tabs; Colors (what the page
shows equals the applied tokens, token editor, footer count, reset); Accessibility (contrast
levels measured as WCAG ratios); « Reset all » (it *replaces* the state); Sharing (export of the current look, copy; a `.json` is
imported as a THEME in My themes and applies nothing, anything else is refused with a visible note);
**My themes** (`library`: save from Essentiel with its window, « modified » and « Update », apply, rename, export,
delete, and — on the sandbox only — the copy on the disk coming back after the browser's is cleared);
the **gallery** (`gallery`, sandbox only: the shipped catalogue read by the host, search, filter, *Try* stores
nothing and is put back, *Install*, *Update*); the « Animation » tab
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
(three real export formats, the copy argument, the CSS export’s 17 × 2 tokens, a JSON file imported back as a theme).
`library` and `gallery` **turn the host half on** for their own part (the run keeps it off otherwise), so they write
under `<DSH_HOME>/kybernos`: they only run disk steps against an isolated instance (`source scripts/sandbox/env.sh`) and
remove what they wrote. The signed catalogue is not in the script (it needs a key the sandbox trusts): see
`docs/dev/theme-gallery.md`.
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
`setFontSize(px)` (`setFontSize('text', px)` on 0.2.1-alpha.2), which DSH stores in the profile (`ui-theme` in
`cordis.patch.yml`), not in the throw-away browser. (A boot used to write the plugin's own size, 15, over DSH's; it now
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
  **Animation**, Accessibilité, Partage, Galerie (« Conversation » and « Terminal » are gone). A tab inserted in the middle moves every
  index after it; the `advanced` section checks the names in order, so a shift is reported there first.
- The wallpaper `<div>` has `pointer-events: none`, so `elementsFromPoint` never lists it: to
  know whether it is visible, look for an opaque element *above* each sampled point instead.
- Tokens are read on `<body>` (that is where DSH and the layer declare them), not on `<html>`.
- The Light scheme is measured **without pressing Mode / Light**: the `light` section removes
  `data-ds-dark-theme` from `<body>` in the page only (client-side, never persisted; the guard keeps
  watching `html[data-ds-theme-source]`, and the attribute is put back in a `finally`). In each of 18
  views (the first seven tabs, the font list and the ambiance list with no match, the settings disclosure,
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
- **The mode found decides the values.** The sandbox is a clone of the user's profile, so it is Light when the
  user's DSH is. Anything that depends on the scheme must be looked up for the scheme that is displayed
  (`displayedDark()`, `CB_PALETTE`, `NATIVE[V.base]`), never assumed Dark: seven checks once failed on a Light
  sandbox for that reason alone (a bright accent is darkened under 3:1 on a white layer, the base colour is white,
  the colour-blind palette has a Light pair), while the same sections were green on Dark. The Dark-only steps
  (« DSH default », « Reset all ») run only when the mode found is Dark: to cover them, set `ui-theme.preference`
  to `dark` in the **sandbox's own** `cordis.patch.yml` (hot-reloaded in a few seconds), never in the real one.
  A change of the plugin's host half (`boot-store.mjs`, `index.js`) needs the sandbox restarted; the browser half
  (`client.js`) only a page reload.
- DSH 0.2.1-alpha.2 renamed two things the Essentiel tab drives: the theme service takes a role
  (`setFontSize('text', px)`, snapshot `fontSizes.text`, not `fontSize`), and its token sheet declares
  `--dsw-font-family` again on `body`, which shadows a rule that only targets `:root`. The `font` section pins
  both: the text size really moves `--dsh-content-font-size` on `<body>`, and `getComputedStyle(body).fontFamily`
  starts with Georgia once it is picked.
- Several agents may share one DSH: another session switching the real GUI to Light during the
  run is caught by the mode guard above, and is not a failure of the page. A switch of DSH's
  *language* reloads every open page and flips labels mid-run: each section compares `<html lang>` at its
  start and end and prints `! the interface language changed…` — read the failures of that section as invalid.

## The hosted Team console page, read-only: `scripts/check-team-live.mjs`

```bash
node scripts/check-team-live.mjs --console-url <url> --shots /tmp/shots       # + screenshots of Members, Providers
node scripts/check-team-live.mjs --console-file <path>/workspace-console.html  # test the console you are editing
node scripts/check-team-live.mjs --console-file <path> --capture-labels        # re-freeze the label baseline (see below)
```

DSH no longer frames this page: the account menu's Team settings, Account and Referral open the app in the browser, and the read-only account frame (the
iframe, its relay, its key hand-off) is gone from the core (`docs/dev/frame-removal.md`). The script is kept for whoever edits the console page itself; it needs
the page's address given (`--console-url` or `--console-file`) and exits 3 without one. It writes nothing: no setting, no key, no language, and DSH is not
restarted (it only uses the page of `dsh web` as a Chrome to drive). It loads the console in the throw-away Chrome at the width DSH used to give the frame and
reads each of its pages (the list comes from the page, not from the script).

- **console**: every page opens without a script error, shows no `undefined` / `NaN`, and has no element wider than its
  column. The Members table is 101 px too wide today, so this check is red until that is fixed.
- **labels**: `scripts/team-console-labels.json` freezes the static labels of each page (headings, buttons, tabs,
  columns, field labels, helper lines; no numbers, no names). A rework may not lose one silently: a label that is meant
  to go is listed in `allowRemoved` with the owner's approval. The baseline does not protect sentences outside those
  elements. Re-freeze with `--capture-labels` only on a console you trust.
- **`--console-file`**: the file is served on a free local port instead of reading the hosted console.

Every dialog or side panel a page owns is opened and read (Plan: Compare plans; Members: a member's details and the filters;
Usage: the filters), the segments that swap a view are pressed (Usage: group by), and every inner tab is checked for overflow,
so a label that moved behind a click still counts as reachable and nothing hides a table wider than its column.

Printed, never failing: the number of controls and the scroll height of each page. The count is one rule for the console and for any mockup (visible fields plus
the outermost clickable elements), so a before / after comparison is fair.

Needs the network when the console is the hosted one; exit 3 when it cannot be reached.

The data bridge with a key against a stand-in gateway, and the console run through a relay host page (the way DSH ran it), were checked here too; they went with the
frame, together with `lib-fake-team-gateway.mjs`, `lib-fake-relay-host.mjs` and `scripts/check-relay-real.mjs` (what stays of that one is `scripts/check-server-real.mjs`:
the open `GET /kybernos-cloud/server` route of the running host). The cloud client's React render half runs only where `react` and `react-dom`
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
  from DSH itself, or data (session titles, agent team descriptions, workspace names).

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
- A fresh instance used to cover the page with DSH's « Get started » dialog (it swallows mouse events). The core now replaces that
  step; `live-page.mjs` presses the dialog's Close cross if an engine shows it anyway (pass `keepKeyDialog: true` to see it, as
  `check-onboarding-live.mjs` does). The paid module `@local/kybernos-servers` is read
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

## The sidebar footer: `scripts/check-footer-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-footer-live.mjs --shots /tmp/shots
```

Sandbox only (exit 3 against `:3080`). The footer is **one button**: « Sign in / Sign up » signed out, the profile row connected, both in
the same place and at the same size with the same chevron, and each opens our menu. The check plays it on a real page with real mouse
clicks:

- **Signed out:** the one button, its menu (Sign in = the device-code card, Create an account, Appearance, Settings, Website, Help, Send
  feedback), Escape / outside click / toggle, the three links (`window.open` is recorded, never followed), the Settings entry reaching DSH's
  dialog, the pairing state, the sun/moon segment.
- **The keyboard only** (both menus): Enter on the focused button opens the menu with the focus on its first item, ArrowDown / ArrowUp walk it and wrap,
  Home / End jump, Escape and Tab close it and give the focus back to the button. The keys are real key events (`Input.dispatchKeyEvent`); nothing is
  focused by the page after the first focus. (The signed-out menu is a portal on `<body>`: without this it was out of the Tab order's reach.)
- **Connected** (the status route is answered in the page): the profile row, the menu's skeleton, **Team settings, Account and Referral asking
  the host for a console link** (`section: plan`, `overview`, `overview`, on the active workspace, `open: true`; nothing is drawn in DSH's content
  zone; what is said when it is refused). **The gift card's « Open the referral page »** (opened by its window event `kybernos:menu:gift`, since the icon row is zero-size and hidden)
  asks the footer the same way (`section: referral`, `open: true`, the active workspace: the card closes and the footer says what happened, also for a server that does not answer);
  signed out, the link is followed (not cancelled) to `<web>/account#referral`.
- **No frame** (the read-only copy of the account pages that DSH used to draw in its content zone is gone: `docs/dev/frame-removal.md`): the scenes that opened it
  through `window.__kbOpenWsConsole(<page>)`, against console stand-ins and the sandbox host's relay route, are gone with it. What stays is the proof that nothing is
  drawn: no `[data-kb="ws-console"]` after Team settings, Account or Referral. The menu's Account entry asks the host for the console link itself, a refusal is said above
  the footer, and a host that could not open a browser hands the address back for the page to open. The notification bell is hidden behind `SHOW_BELL` in the cloud client
  and the check asserts it is absent.
- **Remote control** (the phone link's status route, `kybernos-mobile/remote/status`, is answered in the page): the entry sits right after
  Referral with the number of phones already linked, opens kybernos-mobile's own panel, and is absent when the server does not offer the
  feature (`configured: false`), the plan does not include it (`entitled: false`), DSH cannot (`available: false`) or the status cannot be
  read. The footer has no phone button of its own any more: `check-mobile-remote-live.mjs`, `check-mobile-remote-pages.mjs` and
  `check-display-live.mjs` open the panel through this entry.
- **Upgrade and « See plans »** (every answer is in the page; nothing is bought and no server is called): connected on Plus the menu has « Upgrade »
  right after the plan and before Team settings, with the arrow that leaves DSH; on Free there is the pill and no entry (it opens the dialog), on Pro (the
  top level) and on a paid Team plan there is none, and when the catalogue cannot be read the entry stays. Pressing it asks the host for the console link on the
  active workspace's `plan` page with `open: true` (Team settings' own call), opens no dialog and draws nothing in DSH. Signed out, the menu is Sign in,
  Create an account, **See plans** (the server's own `/account#plan`, recorded and never followed), Appearance, Settings, Website, Help, Send feedback.
  Every payment route of the page is answered here as « no payment provider » unless a scene sets it; the phone link's gestures (pair, approve, revoke) are
  answered too (refused unless a scene sets `fake.pair`). The hosted-page rule (no entry off loopback) is unit-tested (`test-cloud-client.mjs`), not played live.
- **A server that does not answer** (the host's answer carries `server: { name, host, can_switch }`): the footer's notice names it (“label” and host) and offers
  « Switch server » when another server exists (Settings opens on Servers; skipped, visibly, in a sandbox without the Servers module), and none when it is the only
  one; the phone link's panel says the same and its « Switch server » closes the panel first. Three scenes run again at **390 px** (the drawer opened by
  « Open the menu »: the menu with its entry, the notice and the signed-out menu must fit the window). With the sandbox's registry pointing at a closed local
  port the REAL host answers the same way (the check does not need it: `POST /kybernos-cloud/console/link` and `/kybernos-mobile/remote/pair` both come back with the server).
- **DSH's Settings** (connected scene): the navigation lists none of the five account entries that used to be ours (Account, Referral,
  Account security, Account data, Support & legal; matched by the React key each cell is rendered with, and by title for the four that have
  no namesake in DSH) while General, Appearance and Remote Control are still listed and still open. The account's pages are the footer
  menu's embedded ones: nothing replaces the entries in Settings.
- **The « Kybernos » section of Settings** (kybernos-cloud's `kybernos-local`: what stays on this computer): one group header « Kybernos »
  (no « Account » header any more) holding Servers (kept first), the section, then the Suite. Signed out the section is there, the two
  server actions say so and are disabled, the instructions field works. Connected: the instructions are saved through the host's file
  routes into the **sandbox's own `<DSH home>/AGENTS.md`** (read back after a reload, removed when emptied, a reserved marker refused;
  the file is put back as it was at the end). The models line says the list updates by itself; « Import models » and « Send DSH chats » are
  under a folded « Advanced » (unfolded by the check): the first calls its host route (answered in the page) and a refused re-import says so,
  the second asks « Send the list now? » first and calls its route only after « Yes, send » (Cancel sends nothing).
- **The Upgrade dialog** (the catalogue, quote, checkout and portal are answered in the page; the host routes behind them are proven by
  `packages/kybernos-cloud/test-billing-proxy.mjs`): loading, the levels of a personal workspace, yearly/monthly and currency, Subscribe
  and what the dialog says after it, then every refusal — 501 (no payment provider), 403 (not an owner or admin), 409 (the billing portal is
  offered and works), 422 and 502 and an unreachable server (a retry) — a catalogue that cannot be read, a team workspace's seats priced
  by the server's quote, top-up packs.
- **The Teams menu** (the account, the usage, the choice of a team and « is the route applied » are answered in the page; every click is real): with 1 and 3
  spaces the menu lists them itself (tile in the team's colour, name, « Admin · 6 members » or « you · plan », usage percent with its bar, check on the active one,
  « Create a team »), with 4 and 6 the top row stays « Switch team » and opens the full list next to the menu; the plan card by role and by state (member / admin ×
  normal / 75 % / used up with its time of return / a cap set by an admin: the Team bar for 30 days and the person's own 5 hours and 7 days, « Manage » for an owner or
  admin and « Add credits » only once the pool is used up, both through the console link, never a dollar, euro or credit amount, never a time of return for a window that
  has room); the personal free card; a switch (real click on a row: the card says « Switching… » with the chosen team, busy and not pressable, no meter, until the host
  has been asked and said the route is applied; a route the host could not rewrite is said at once); the cues of a team space (the memory pill in the team's colour, none
  in the personal space, a folder pill only when `state.space_folder` names a folder, « Message Acme… », « What is Acme working on? », in a conversation's dock too);
  the same in French (the page's language function is overridden for the check, DSH's stored language is never touched); the contrast of the small text and of the
  pill in both schemes, measured on what is really drawn (`data-ds-dark-theme` on the body is the truth, not the attribute the core plugin keeps); a phone at 390 px.
  Unit side: `packages/kybernos-cloud/test-teams-menu.mjs` (the pure rules), `test-cloud-client.mjs` (rendered), `test-cloud-host.mjs` (the host's routes).

- **The guard** (below): a script's click on DSH's launcher, a real click on it forced visible, React's fiber fields unreadable.

In every scene it records any popover of **DSH's own account launcher** (« Settings ⌥⌘, / Feedback / Sign in ») that becomes visible,
and fails if one does.

Why: DSH's settings seat (`sidebar.settings`) renders the **account launcher** (`settings.launcher`, registered by
`dsh-client-ui-settings-account`) and its trigger opens an account popover, not the Settings dialog. Anything that clicked
`[class*="settingsArea"] button[class*="trigger"]` to reach Settings got that popover. The seam now lives in the core plugin
(`window.__kbOpenDshSettings`, `<kb-open-settings>` in `packages/kybernos-plugin/client.js`): it calls the launcher's own
`openSettings` prop, read from React, and a capture-phase guard on the launcher turns any script's click into the same call. The
dialog is opened by that seam, never by clicking a trigger: new code should call it, not the old selector.

A fresh instance opens DSH's « Get started » dialog (sign in to a DeepSeek account / add a key) on every load; it swallows every
click, so the check closes it with its own close button after each reload.

**A real run against the local replica** (the Kybernos server on `http://localhost:8791`; write `{"active":"kybernos-local",…}` in the
sandbox's `kybernos/servers.json`): press « Sign in », approve the code with `POST /v1/device/approve` (the demo account's session),
then Account, Upgrade and Subscribe return the replica's real answers (the stand-in payment page at `/pay/cs_N`). Strip `open` from the
payment and console-link POSTs (CDP `Fetch.continueRequest`) so that the host does not open a browser on your machine; do not press the
stand-in's « Pay »: it changes the shared demo account's plan. « Disconnect » when done (it revokes the device on the server).

### The delay of a team switch (measured on a sandbox, 2026-10-18)

`setActiveSpace` rewrites the model route (`settings.mutate('llm-pi-ai', …)`) and a message sent before DSH runs the new route still carries the PREVIOUS team's
`x-kybernos-workspace`. The host's `POST /kybernos-cloud/space/applied { workspace_id }` answers whether the RUNNING route names the space (it reads `settings.describe()`,
DSH's view of the running plugin, not the file that was written), and the footer says « Switching… » until it does (3.5 s at least when it cannot tell, 15 s at most).
Measured with the sandbox host, a fake Kybernos API on a local port (`KYBERNOS_CLOUD_API` and `KYBERNOS_CLOUD_STATE` in the environment of `scripts/sandbox/start.sh`,
a connected state file written in the sandbox's DSH home) and the route called from Node with the sandbox's own session cookie, 10 switches between three spaces:
`space/active` answered in **1.77 s** (median; 7 of 10 between 1.73 and 1.84 s, 3 of 10 between 0.17 and 0.41 s) and the running route named the new space **when it
answered**: polled about every 15 ms from the moment the call was sent, the first poll that saw `applied: true` came 14 to 17 ms after the answer in 9 of 10 (one poll) and 32 ms before it in 1 of 10; in a
separate run of 8 switches the first poll after the answer already said `applied: true` every time.
So `settings.mutate` returns once DSH has reloaded, and the window in which a message can carry the old header is the duration of the host call itself, which the card covers.
**Not measured:** the header a real chat request carries in that window (a task run through `POST /kybernos/tasks { action: 'run-now' }` used DSH's default model: `selectModel`
did not take in this sandbox, so no request reached the fake endpoint). The claim « running route names the new space ⇒ the next request carries it » is inferred from DSH's
settings contract, not observed.

## Joining a team with an invitation link: `scripts/check-join-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-join-live.mjs [--shots <dir>]
```

The real DSH page, the real host routes of `kybernos-cloud` and a **fake Kybernos server started by the check**: it restarts the sandbox with `KYBERNOS_CLOUD_API` and
`KYBERNOS_CLOUD_STATE` pointing at the fake and at a throw-away connected state file, and restarts it signed out when it ends (what `check-footer-live.mjs` expects). It refuses
:3080 and any `DSH_HOME` outside `.kybernos-sandbox`. The fake answers each invitation as the server's contract does: a good one, a team without a plan, ONE 404 for every unusable
one, a full team (409 `seat_limit`: the link must stay valid), 429, an unexpected 500 and a server that hangs up; it records every request, so the checks say where the token went:
only to the fake (the active server), in the body of a POST, never in an address, never in the sandbox's log, no device token on the public preview. Real clicks and keys: the
row under « Create a team » (inline for 2 spaces, in the « Switch team » panel for 4), nothing sent before the click, junk and a non-invitation link refused in words, the preview card,
« Join the team » then the ordinary switch (the card says « Switching… », the model route is rewritten in the new team's name), a team without a plan (the person stays, told),
every refusal with its sentence, the server's own page offered for the unexpected one, the guard of the routes with the sandbox's own session cookie (no Origin 403, foreign Origin 403,
no cookie 401), both colour schemes (contrast), a phone at 390 px, French. Exit 0 / 1 / 3.

## One working folder per team: `scripts/check-team-folder-live.mjs`

```bash
source scripts/sandbox/env.sh && node scripts/check-team-folder-live.mjs [--shots <dir>]
```

The real DSH (its workspaces, its sidebar, its « New chat »), the real host routes of `kybernos-cloud` and the same fake Kybernos as the join check (`scripts/fake-kybernos.mjs`); the
folders are made in the SANDBOX's own `~/Documents/Kybernos` (it refuses a `HOME` that is not the sandbox's). It restarts the sandbox pointed at the fake and restarts it signed out when
it ends. On real clicks it proves: switching to a team makes `<Documents>/Kybernos/<Team>`, DSH has a workspace for it (the sidebar's « Workspaces N » grows) and a NEW chat is open in it
(the new chat's workspace pill says the team's name, and the composer's folder pill appears by itself); **the control**: DSH's own « New chat », pressed in the team's chat, stays in the
team's folder, which is what a switch back to Personal must not do; the switch back opens a new chat in the workspace the person had; two teams, two folders, two workspaces; a folder
the person removed is made again at the same path; a team called `../../etc/passwd` gets ONE folder under the root (`etc passwd`) and nothing is made outside it; two teams called « Acme »
get two folders; a team created without a plan has its folder and opens nothing, one created with a plan takes over and its chat opens; a team joined with an invitation link; an active
team with no recorded folder gets one at the next page load and no chat opens; a disk that refuses (the root made read-only) leaves the switch working with no folder, no pill, no error, and
the next page load makes the folder once the disk allows it. Not proven here: a chat that was already started keeping its folder (no model answers in the sandbox, so no message is
sent: a session's folder is DSH's own rule). Exit 0 / 1 / 3.

## The Automations board: `scripts/check-automations-board-live.mjs`

```bash
source scripts/sandbox/env.sh && scripts/sandbox/start.sh     # an isolated instance serving this checkout (restart it after a host edit)
node scripts/check-automations-board-live.mjs [--shots <dir>] [--stub-model]
```

The three views of the Automations page (Columns, Calendar, List). It **refuses to run against 127.0.0.1:3080 and against any
`DSH_HOME` that is not under `.kybernos-sandbox`**: it writes the instance's `kybernos/tasks.json` (seven automations: a daily, a
weekly, an every-6-hours, a one-time, a webhook-only, a failing one, a paused one; the scheduler adopts them, which is the real
path) and puts the file back. It plays, on real clicks: the switch and its persisted choice (a stored `cards` opens the List), the
columns and what each holds, the calendar (week, month, folding, planned runs, the detail strip, previous / today / next), 375 px,
the host held back or refused over CDP `Fetch` (loading skeleton, banner and retry), French, an automation that can never fire,
the empty page, and **« Run now »**: the host starts a real session, and the board must say no more than the engine's own sidebar.

`--stub-model` adds what a real model makes rare, with a **stub OpenAI-compatible endpoint started by the check**: it adds a
`kbstub` provider to the *sandbox's* `cordis.patch.yml` (the original is copied back afterwards), restarts the sandbox with
`KB_STUB_KEY` set, and plays a model that never answers (the run is *running*, and the engine's sidebar says « Running »), then a
model that calls `bash` with `sandbox_permissions` (the engine turns it into an approval request: the run *waits*, the card shows the
engine's own words, the sidebar says « Waiting for approval »), answered once with Refuse and once with Approve. The check reads
what the model got back (a refusal, then the output of `echo`). It restarts the sandbox twice, so the browser page is reloaded.

Without `--stub-model` a run that is running or waiting is not seen live: the pure test `test-automation-board.mjs` covers the
mapping from the engine's structures. In a sandbox with no model key a run ends at once, so « Run now » alone only ever shows
`ended`. The board's own `data-kb` hooks: `board-columns`, `board-col` (`data-col`), `board-card` (`data-col`, `data-state`,
`data-task`), `board-calendar`, `board-week`, `board-day`, `board-event`, `board-month`, `board-mcell`, `board-detail`,
`board-banner`, `board-action` (`data-act`). Exit 0 / 1 / 3.

## The Automations List and « Edit in chat »: `scripts/check-automations-list-live.mjs`

```bash
source scripts/sandbox/env.sh && scripts/sandbox/start.sh     # restart it after a host edit (the frequent-schedule guard is host code)
node scripts/check-automations-list-live.mjs [--shots <dir>] [--at HH:MM]
```

The page says « Today » / « Tomorrow » / « Yesterday » from its own clock, so the check never writes those words: it seeds from « now »,
works the expected words out from the page's clock in the same read, and waits for the board to have its cards (it takes up to ~10 s
after the file has a next run). `--at HH:MM` (or `KB_CLOCK`) proves it: the page's `Date` and the seeds move to that time of today
(`--at 08:00` and `--at 23:55` are both green); the host's scheduler keeps the real clock. Exit 0 / 1 / 2 (bad arguments) / 3.

Same guards as the board check (never :3080, only a `.kybernos-sandbox` home; it writes the instance's `kybernos/tasks.json`, eight
automations, and puts it back). It plays, on real clicks and real routes: the header over its cells (same left edge, every column, every
row), one card with one border, the line under the name, the actions at the right (hidden at rest, shown on hover and on keyboard focus,
a starred row keeps its star), the small switch and the one hover band; the schedules in words and their tooltips; no dd/mm date and
the same style in a card's chip and date line; a schedule in another zone naming it; the Schedule form's time field and the presets
keeping the time; `POST /kybernos/tasks` refusing `* * * * *` without `confirmFrequent`; « Edit in chat » from a row and from the page
of an automation (a NEW chat, a draft naming the skill and carrying the definition, nothing sent); 390 px. Chrome cannot emulate
`(hover: none)`, so « always visible on a touch screen » is the one rule it does not see: the CSS is `@media (hover:none)`. Exit 0 / 1 / 3.

## The Creations, Agent Teams and Skills pages, and the skeleton screens: `scripts/check-pages-live.mjs`

```bash
source scripts/sandbox/env.sh && scripts/sandbox/start.sh     # an isolated instance serving this checkout (restart it after a host edit)
node scripts/check-pages-live.mjs [--shots <dir>]
```

It **refuses to run against 127.0.0.1:3080**: the Skills steps write the index-source setting and the Featured list of the
instance's DSH home (both put back at the end). It plays, on real clicks and keys:

- **creations**: « Customize » is a small control on the hint line (not a tile, tiles on one row), its panel hangs under it;
  a row has no « View » / « expand » button, its quick actions are hidden at rest, shown on hover and on keyboard focus, always
  shown with no hover (touch), the name keeps its width at 400 px; a Data row says what it holds, a Data card is a table or a few
  fields, an opened Data creation is a table or a tree with « View source » one click away;
- **agent teams**: the sidebar entry says « Agent Teams »; the tab row does not move between the Agent Teams and Marketplace tabs (1400 and 640 px);
- **skills**: a stand-in relay (loopback) answers 502 → the message, the automatic second attempt, « Try again » and « Change »,
  the other tabs untouched; the source line; a bad address refused with the variable's rule; the Featured list and the ranking
  are the same rows; at 640 px nothing is cut off at the right;
- **skeletons**: the host's answer held back over CDP `Fetch`, bones drawn in the box of the real rows (the first row lands where
  its bones were), no shimmer under `prefers-reduced-motion`, only the first twelve rows fade in. The rules and the helper are in
  `skeleton-screens.md`.

A check that has nothing to compare (no creation, no Agent Team, nothing featured in the instance) says so and moves on. Exit 0 / 1 / 3.

## A broken bundle must not stop DSH: `scripts/check-bundle-faults.mjs`

```bash
node scripts/check-bundle-faults.mjs [--only kybernos-atlas,dsh-mermaid] [--faults syntax,throw-apply] [--gui] [--port 3097]
```

AGENTS.md rule 2 as a measurement. In a copy of the tree served by a throw-away sandbox profile, the script breaks ONE bundle at a
time (syntax error, throw at load, throw in `apply`, missing dependency, missing entry file, cut or missing `package.json`, a top-level
`await` that never ends; with `--gui` also a broken, throwing or missing `client.js`), starts DSH and reports whether it started,
whether every OTHER bundle still mounted its routes, whether the log names the entry that failed and, with `--gui`, whether the page
still renders. It exits 1 on what a bundle can prevent. Measured 2026-10-08 on 34 bundles (272 host runs, 90 client runs):

- DSH started in every run with a broken host half; the other bundles lost nothing; the failure is always in the log
  (`dsh: warning: N entries did not activate` plus the stack); the GUI renders.
- A broken `client.js` (any of the three faults, any bundle) replaces the **whole GUI** with the engine's « Failed to load plugins »
  screen. That is the engine waiting for every client entry: a bundle cannot prevent it, only the release gate can (`node --check`
  in CI, the signed archive).
- A host half that never finishes loading (`tla-hang`) leaves the web server up and the GUI usable, but the `dsh web: http://…` banner
  (the only place the login URL is printed) never appears. A host half that spins the CPU at load takes the whole process down.
  Neither is fixable from a bundle: do not `await` the network at the top level of an `index.js`.

The core is `packages/kybernos-plugin`, but DSH calls it `@local/kybernos`, it prints its boot lines as `[kybers] …` / `[gateway] …` and it mounts
`/kybernos/*`: the script reads the log names from each bundle's `package.json` and its boot tags from the bundle's own sources, and it
attributes `/kybernos/<short name>/*` to that bundle and the rest of `/kybernos/*` to the core. The probe routes must answer 200 on a
healthy sandbox (a probe that always says 404 sees nothing); it waits up to 12 s for them to come back instead of judging them 2.5 s after the
banner.

The sandbox does not copy credentials and the script never touches `:3080`. Run it under a profile with no network if you want it
to be certain that nothing leaves (a `sandbox-exec` profile denying outbound connections to everything but loopback works on macOS).

### The server misbehaves

`packages/kybernos-cloud/test-cloud-resilience.mjs` (hermetic) plays a programmable fake server against the REAL host routes: an
answer of 96 MB, a redirect (307, 302), a poll that is not a verdict (429, 5xx, HTML), a captive-portal page in place of the workspace
list, a body cut short, a Team list with entries that are not lessons. The same mistakes are covered, one file each, for the feedback
send (`kybernos-plugin/test-feedback.mjs`, 13), the skills relay (`kybernos-skills/test-index.mjs`, 8), the models.dev read
(`kybernos-models/test-no-engine-fetch.mjs`) and the TTL sweeper (`kybernos-computers/test-computers-host.mjs`).
**Rules these tests pin:** a bundle's network read is bounded in size and time; a redirect is not followed; the engine's
`ctx.web.fetch` is not used for a request of ours (its HTTP provider kills the whole process when a connect fails at once: no route, a
firewall answering EPERM); a promise started with `void` carries a `.catch`, because an unhandled rejection ends DSH.

## A skip is never a pass

Every test that cannot run where it is (`test-*.mjs`, `check-*`) prints a line that starts with `SKIPPED:` and says what is not
covered and why (no playwright, no jsdom, no python livekit, no DSH engine, a platform, root…), and a whole suite that skips ends with
a summary line (`… 0 assertions run, SKIPPED`). The CI keeps the output of its two test loops and ends with `SKIPPED SUMMARY: N` and the
list, so a green run states what it did not cover. `scripts/test-live-checks.mjs` fails on a test that prints « skipped » without it.
`check-display-live.mjs` lists every view it could not measure the same way, and `--strict` fails on them. At 390 px the profile card lives in
the closed drawer: the check opens the drawer with the card on screen (`drawer(CARD)`, reloading and retrying when a late redraw closed it) and
reports a view it still cannot reach; the phone panel's paywall is measured in Settings › Remote Control, because the profile menu offers
Remote control only to a plan that includes it.

`scripts/check-opencode-probe-live.mjs` asks the REAL OpenCode CLI of the machine whether it is signed in. It reports a fact about the
machine and is not a gate: the logic of that probe is tested hermetically (a stand-in CLI in both states) by
`packages/dsh-subagent-maison/test-noyau.mjs`.

## What a person would see wrong: `scripts/check-display-live.mjs`

```bash
source scripts/sandbox/env.sh && scripts/sandbox/start.sh
node scripts/check-display-live.mjs --out <dir> [--sizes desktop,narrow] [--schemes dark,light,neutre] [--only home,settings]
```

A sweep, not a gate (exit 0; `--strict` makes any finding exit 1; 3 when it could not run; it **refuses `:3080`**). It walks the
home page and its menus, the sidebar pages and their tabs, every Settings section and its tabs and help card, the right pane's panels (`--only panels`:
Slides empty, with its demo deck and its text editor open, Bricks and Modeleur empty), the account card
(menu, switcher, update reminder, the phone panel in each of its five states, Settings › Remote Control) and the first-run wizard, with
real clicks, on a 1400 px window and at 390 px (the width `kybernos-mobile` lays out for), in DSH's dark theme, its light theme
and the shipped *Neutral violet*. The account, the phone link and the wizard are answered **inside the page** (CDP Fetch on
`/kybernos-cloud/status`, `/kybernos-mobile/remote/*`, `/kybernos/onboarding`): no server is called, nothing is written.

Per view it measures, from computed styles and boxes (not from the source):

- **contrast**: every visible text, input value, placeholder and small icon against its effective background, layer by layer
  (opacity groups, gradients at their worst stop, CSS-mask glyphs read as ink); 4.5:1, 3:1 for large text and icons. A switch whose
  knob merges with its track is listed too. Disabled controls are measured but not counted;
- **clipping**: a box that leaves the box that really contains it (containing-block chain: an absolutely positioned popover is not
  blamed on a static `overflow:hidden` parent) or the viewport, with no scrolling to reach it. Thumbnails and ellipsised inline
  text are skipped as deliberate crops;
- **cut labels**: text that overflows its own `overflow:hidden` box with no `title` or `aria-label` anywhere above it;
- **layout jumps**: `layout-shift` entries (>= 0.02) that are not caused by the person's own click.

`<out>/report.json` lists each finding with a selector, the screenshot where it was outlined (`<out>/shots`, numbered boxes) and
where it was seen; findings are grouped across schemes. Keep the output outside git. Traps: DSH's mode is persisted by its theme
service, so each pass sets it through the real Theme page and a run needs its own sandbox (`KB_SANDBOX_ROOT`, a port of its own);
findings on the DSH shell itself (classes with a hashed prefix such as `VOzbGW_navCell`) are not the plugins' to fix.

Two things to know when reading a report. A **panel kept by the host survives from one page to the next** (the right pane, its tabs, the Slides demo deck): the `panels` scenario
opens a panel that is already there, and shows the empty Slides state only on a fresh host (restart the sandbox to see it again). And a `Leave site?` dialog (a panel with an
unsaved edit) would hold every later reload for ever: the sweep answers it at once. What the sweep cannot see: a `filter` (kybernos-models draws its capability icons through
`brightness(.72)` in the light schemes; the sweep reports their raw colour) and an animation caught half-way (the faded steps of an animated help card).

The same rules, read from the source, are `scripts/test-display-rules.mjs` (run by CI). It resolves the colours for real (DSH's token values in
both schemes, `var()`, `color-mix()`) and holds, for each defect the sweep found, the pair of colours that must not come back: a panel's empty state
on its fixed light stage, an off switch's knob against its track, a type badge or a tag on its tint, the page roots that lift `label-tertiary` in the
light schemes. `KB_DISPLAY_KEEP_GOING=1` lists every failing rule instead of stopping at the first; `KB_DISPLAY_ROOT=<another packages folder>` runs
the same rules on an old tree.

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
- **A class prefix belongs to one bundle.** The Language page used to share `kbth-` with the Theme page (`.kbth-page` was true on both, and
  the later stylesheet restyled the other's page); it is `kbln-` now. `scripts/test-consistency-guards.mjs` fails when two bundles declare the
  same selector differently, and `node scripts/audit-css-prefixes.mjs` lists them. To ask « is the Language page shown? » use
  `[data-kb="language-page"]` or `[data-act="add-language"]` all the same: they do not depend on a class.
- **A click on a position hits what is on top.** With Settings open, the sidebar footer is covered by the nav: clicking the
  ring's coordinates selected « Theme ». Close Settings with a real click on « Back to workspace » first, and check it closed.
