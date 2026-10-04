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

## The Language page, end to end: `scripts/test-language-live.mjs`

```bash
node scripts/test-language-live.mjs --shots /tmp/shots   # screenshots of every step
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
(the runtime in isolation: registration, following DSH's selector, the boot grace period) and,
for the host route, `packages/kybernos-plugin/test-i18n-translate.mjs`.

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
