---
name: new-kybernos-plugin
description: Create a new Kybernos plugin (a DSH bundle under packages/<dir>) in this repository, from the empty skeleton to a registered, tested, documented bundle. Use whenever someone asks to add, create, scaffold or build a new plugin, bundle, satellite or module for Kybernos/DSH, or to split a feature out of an existing plugin into its own one.
---

# Create a Kybernos plugin

A plugin is a **bundle**: a folder `packages/<dir>/` that DSH loads as `@local/<dir>`. It has a
host half (`index.js`, runs in `dsh web`) and a browser half (`client.js`, runs in the GUI).
This skill takes you from nothing to a bundle the lifecycle robot can install, the Suite panel
lists, and CI accepts.

Read `AGENTS.md` first. The seven rules there are not negotiable; the ones that shape a new
plugin are repeated below.

## 0. Is it really a new plugin?

- A new *page, pill, panel or tool* usually deserves its own bundle (removable, testable alone).
- A tweak to an existing screen belongs in that plugin. Do not create a bundle for it.
- **Zero new engine patches.** Everything goes through plugin seams: `ctx.inject`, slots,
  `systemPrompt.context`. If you think you need to patch DSH, stop and say so in the PR.
- **A bundle must never stop DSH from starting.** Wrap `apply()` of both halves in try/catch and
  degrade (return a disabled plugin) instead of throwing.
- Optional by default. Only the socle (`kybernos-plugin`, `-hub`, `-theme`, `-sessions`, `-skills`)
  is always on; a new plugin is a **satellite** the user can switch off.

## 1. Name it and check for collisions

- Folder `kybernos-<thing>` (lower-case, one word or hyphenated), package name `@local/kybernos-<thing>`.
- `ls packages` — the name must be free.
- **CSS class prefixes are shared by every bundle** and collide silently. Pick a prefix of 3-5
  letters and run `grep -rn "\.<prefix>-" packages | head` before using it. Same for DOM ids and
  `data-kb` values.
- Slot ids and route paths are global too: routes are `/kybernos-<thing>/...` (or `/kybernos/...`
  for the core). `grep -rn "'/kybernos-<thing>" packages` must return nothing.

## 2. Pick the surface and copy the closest existing bundle

| You want | Slot / mechanism | Copy this one |
|---|---|---|
| A page in Settings | `settings.section` (`{ name, id, order, label }`) | `kybernos-workers` |
| A row in Settings › General | `settings.general.item` | `kybernos-sessions` (`ReglagesKybernos`) |
| Pills / a bar under the composer | `conversation.composer.dock` (component receives `{ sessionId }`) | `kybernos-sessions` (`Pills`) |
| A tab in the right pane | `sidebar.right.pane.tab` | `kybernos-bricks`, `kybernos-slides` |
| A card in DSH's Plugins panel | `plugins.item` | `kybernos-computers` |
| Changes to messages in the chat | DOM observer, no slot | `kybernos-refs` |
| Host only (routes, a tool) | `ctx.get('webServer')` / `ctx.inject(['webServer'], …)` | `kybernos-hub` |

Registering a slot always has the same shape:

```js
ctx.effect(() => ctx.slots.inject('<slot name>', () => ctx.slots.register(
  { name: '<slot name>', id: '<dir>', order: <n> },
  (props) => React.createElement(Component, props))), '<dir>: <what this does>')
```

and the client entry must return `{ inject: ['slots'], apply }` (or call `ctx.inject(['slots'], …)`)
so DSH waits for the service. Look at `kybernos-workers/client.js` (`monter`/`demarrer`) once;
do not invent another shape.

## 3. Write the skeleton

`packages/<dir>/package.json`

```json
{
  "name": "@local/<dir>",
  "version": "0.1.0",
  "description": "<one sentence, what the user gets>",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

`packages/<dir>/cordis.patch.yml`

```yaml
- insert:
    - id: <dir>
      name: '@local/<dir>'
```

`packages/<dir>/index.js` — host half. No `@deepseek-ai/*` import (a `@local/…` plugin cannot
resolve them). Even a client-only plugin needs this file; keep it empty:

```js
export const name = '<dir>'
export function apply (ctx) {
  try {
    // routes: if (ctx.get('webServer') !== undefined) monter(ctx.get('webServer'))
    //         else ctx.inject(['webServer'], (h) => monter(h.webServer))
  } catch (e) {
    console.log('[<dir>] disabled: ' + String(e?.message ?? e))
  }
}
```

`packages/<dir>/client.js` — browser half. The factory **must return a plugin object**
(`apply`, optionally `inject`); returning nothing breaks the whole entry ("invalid plugin,
received undefined"). On any error return a disabled plugin:

```js
window.__ModuleLoader__.load({
  id: '@local/<dir>',
  factory: (require) => {
    try {
      const React = require('react')
      // ... your component, your styles (one <style data-plugin="@local/<dir>">, removed in the effect cleanup)
      return { name: '<dir>', inject: ['slots'], apply (ctx) { /* slot registration, see §2 */ } }
    } catch (e) {
      console.warn('[<dir>] disabled:', e)
      return { apply () {} }
    }
  }
})
```

Rules for the client:
- Colours and sizes from DSH tokens (`var(--dsw-alias-label-primary)`, `--dsw-alias-bg-layer-2`,
  `--dsw-alias-border-l2`, `--dsw-alias-brand-primary`…), with a fallback value. No hard-coded
  theme colours: the user switches themes.
- One component, one `ctx.effect` per concern. Every effect returns its own cleanup.
- Never touch DOM that React owns structurally. Add your own nodes at the end of a block, or use a slot.
- Stable hooks for tests and live checks: `data-kb="<dir>-<thing>"` / `data-act="<verb>"`.
  Tests and live scripts select on these, never on visible text (the text changes with the language).

### Strings and languages

User-visible text comes in French **and** English, picked at render time, so the Language plugin
can translate the rest:

```js
const lang = () => { try { return String(window.__KB_LANG_RESOLVE__?.() || '').split(/[-_]/)[0] } catch (e) { return 'fr' } }
const kt = (fr, en) => (lang() === 'en' ? en : fr)
```

Code, comments and docs are English (AGENTS rule 6).

### Host routes

- Mount with `webServer.register({ kind: 'exact', path: '/<dir>/…', handler })`.
- **Plugin routes are served before DSH's own auth**, so a route that changes anything must check
  the request origin is the page's own (`sameOriginStrict`; see `kybernos-hub/hub-host.mjs`) and
  must never read or write outside what it owns.
- GET for reads, POST for actions; validate every field of the body; answer `{ ok, … }`.
- Keep the pure logic in its own `*.mjs` file (no `ctx`, no disk) and inject the I/O: that is what
  makes it testable without DSH (`kybernos-hub/hub-host.mjs` + `test-host.mjs` is the model).
- Anything the plugin stores goes under `process.env.DSH_HOME || ~/.dsh`, in `kybernos/<dir>/`.
  Never write `/Users/<name>` paths in code (`scripts/garde-depot.mjs` warns).

### The help (every plugin has one)

Write `packages/<dir>/help.json` — what it is, how to use it in 2-4 steps, where to find it, one thing worth knowing, in French
**and** English, in the words of someone who is not a developer. The catalogue build fails without it, and it checks the
shape (`validerAide` in `scripts/build-catalog.mjs`: lengths, both languages, no `slot`/`bundle`/`endpoint`, no emoji).

```json
{
  "what":  { "fr": "…", "en": "…" },
  "steps": [ { "fr": "…", "en": "…" }, { "fr": "…", "en": "…" } ],
  "where": { "fr": "Réglages › …", "en": "Settings › …", "page": true },
  "good":  { "fr": "…", "en": "…" }
}
```

The Suite shows it on the module's page. If the plugin has a page of its own, put the same text behind a « ? How it works »
button in the page header — one line, guarded, nothing breaks if the Suite is absent:

```js
(typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: '<dir>' }) : null)
```

## 4. Register the bundle (five places)

(Check `git log --oneline -1 dev` against your branch first: the registration tables move often, and a
worktree started from an old `main` reads stale ones. Work from `dev`.)

`node scripts/test-layout.mjs` fails and names whatever you forgot. The list:

1. `scripts/lifecycle-packages.json` — add `{ "dir": "<dir>", "nom": "@local/<dir>" }` (order = mount order).
2. `docs/beta/satellites.json` — add an entry to `satellites.bundles`
   (`dir`, `nom`, `tier: 2`, `obligatoire: false`, `defaut: "actif"` if it should start switched on,
   `role`, `poids_ko`, `lib_vendor: null`) **and** add `"@local/<dir>"` to `ordre_montage.satellites`.
3. `scripts/build-catalog.mjs` — three small tables, all keyed by `<dir>`; the build throws and says which one is missing:
   - `FICHE`: `'<dir>': ['<family>', '<French promise>', '<English promise>']`. Families: `base`, `models`, `teams`, `create`, `data`, `connect`, `cloud`.
   - `TITRES`: the human title shown in the Suite (`'Reference chips'`).
   - `GLYPHES`: the glyph the Suite draws for it (reuse one already in the table).
   - Optional `VEDETTES`: a tagline, a description and bullet points, only for a module that deserves the featured card.
   Then regenerate the Suite catalogue: `node scripts/build-catalog.mjs` (never edit
   `packages/kybernos-hub/catalog.json` by hand).
4. `packages/kybernos-sessions/garde.mjs` — add `'packages/<dir>/client.js'` to `FICHIERS_CHAUDS`
   (otherwise the hot-file guard answers "not a known hot file" and nobody can reserve it).
5. `README.md` — one row in the bundles table.

Add a `packages/<dir>/README.md` when the plugin has a user-facing surface: what it is, where to
find it, how to use it in three steps, what it stores and where.

## 5. Test it

Tests are plain Node scripts, no framework, no DSH, no browser. CI runs every
`packages/*/test*.mjs` from inside its own folder, so a test must work with `cd packages/<dir> && node test-host.mjs`.

- `test-host.mjs`: import `./index.js` (`apply` with a fake `ctx`) and your pure `*.mjs` modules;
  assert routes, validation, the failure paths, and that `apply` does not throw when a service is missing.
- `test-client.mjs`: read `client.js`; assert the contract (the factory returns a plugin, no
  hard-coded colours, every `title`/label goes through `kt`, the `data-kb` hooks exist). Where
  logic is pure, expose it as `__test` on the returned object and assert behaviour, not text.
- Use the same helper style as the others (`ok(name, cond, detail)` and `process.exit(fail ? 1 : 0)`).
- **A script that needs a running `dsh web` must be named `check-*.mjs`, never `test-*.mjs`**:
  CI runs every `scripts/test-*.mjs` with no GUI and would fail the build.

## 6. Verify before saying it works

```bash
node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs   # AGENTS.md gate
node scripts/test-layout.mjs                      # registration (the five places)
node scripts/build-catalog.mjs --check            # the Suite catalogue is current
node --check packages/<dir>/index.js && node --check packages/<dir>/client.js
(cd packages/<dir> && for t in test*.mjs; do node "$t" || exit 1; done)
```

Then look at it for real. Unit tests prove a function, not a page: follow
`docs/dev/live-testing.md` (signed-in headless Chrome, `scripts/live-page.mjs`). The browser half
of a bundle the owner already runs can be tried from your worktree on their GUI with
`scripts/lib-bundle-swap.mjs`; the **host half only loads when `dsh web` restarts — never restart it
yourself** (it interrupts the owner's running sessions).

A **new** bundle is in nobody's profile yet, so build a second DSH that serves your checkout:

```bash
node scripts/sandbox-instance.mjs setup && node scripts/sandbox-instance.mjs start    # port 3091, own HOME and DSH_HOME
```

then write a `scripts/check-<dir>-live.mjs` like `check-changes-live.mjs` (a `check-*` name, never `test-*`: CI has no GUI).
If the bundle can change something (run git, write files, call a service), answer every such request **inside the check**
rather than letting it through: the sandbox runs in the owner's real folders. To switch the bundle on in the owner's own
profile: `node scripts/dsh-lifecycle.mjs satellites --activer <dir>` (from the shared tree, with the owner's go).

## 7. Before the PR

- The compat range in `dsh-compat.json` is untouched, or updated in the same PR with the lifecycle tests green.
- Dead-code rider: delete what you can prove dead (grep, tests) or say why not.
- No media, no secrets, no personal paths. English.
- Say in the PR which slot(s) the plugin uses and that no engine patch was added.
