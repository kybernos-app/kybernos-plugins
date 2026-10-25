# kybernos-hub

The base bundle of the Kybernos suite (`@local/kybernos-hub`, always on). Two jobs: tell
whether DSH boots lead to a usable GUI, and offer the **Kybernos Suite** settings panel.
Nothing here may stop DSH from starting: the host `apply()` and every client entry point
are wrapped in try/catch; a half that fails is skipped (the host logs it).

## Boot guard

- The host records each boot in `~/.dsh/kybernos/boot-state.json` (last 12 boots).
- The client sends beacons to `POST /kybernos-hub/beacon`: `loading` when it starts, `broken` (with the
  bundle names) if DSH's "Failed to load plugins" screen is showing, `alive` once the page has stayed
  visible for 8 s (a broken page used to look alive without the screen check).
- After 2 consecutive failed boots the hub **recommends** safe mode and logs the command. It
  never edits the profile itself: `node scripts/dsh-lifecycle.mjs safe-mode on|off|status`.

## Suite panel

A Settings section (`settings.section`, id `kybernos-suite`, order 29) listing the modules of `catalog.json`
in 7 families. Installed state and switches come from DSH's native plugin manager; the DSH version from
`/kybernos-maintenance/state`, if present. A module with a `plugins.bundle.config` screen gets a Settings button that unfolds it in place.

- **Everything first, Featured one tab away.** The page opens on *All*. *Featured* is the first tab: the six most advanced modules
  (`vedette` = rank in the catalogue) as larger cards with a tagline and the full description. *All*, *Installed*, *Available*
  and *Updates* follow.
  Family chips filter (there are no group headings), and the search matches the human title too.
- **The artwork is the tile of the Plugins page of the web app**: one gradient and one small illustration per plugin (the `ART`
  table of the client, drawn on a 64 grid, injected as drawing elements only: `test-suite-art.mjs` checks that). A module the web
  page has no illustration for yet keeps its catalogue glyph (`glyphe`, 32px, three tones) larger on the same tile, coloured by its
  family. Cards show the human title (`titre`), « by Kybernos » and the version, three lines of the promise, and the badges.
- **Hover actions.** On a card or a row, a hover (or the keyboard) shows *Settings*, a direct link to the module's own Settings
  page (only when the module registers one, it is on, and its entry is in Settings: the cell is found by the section id it carries,
  `REGLAGES`), and *Details*. The switch and the status stay visible. The panel uses the width Settings gives it (the core's 720px
  cap on a section is lifted for it).
- **The module's page.** A click (or Enter) on a card or a row opens it: header with the actions, *Description* (what it does,
  from the catalogue) and *Compatibility* (your DSH, the suite's tested range, the verdict), and a details column. Nothing on
  it that the catalogue does not say. A compatibility chip shows on a card only when DSH is outside the tested range.
- **Grid or list.** Grid: one flat grid of cards. List: one flat row per module (grip, family
  tag, status, switch, install/update, Settings, up/down). Filters and search work in both.
- **Your order.** Drag a row, or use the up/down buttons; with a filter on, a row moves relative
  to its visible neighbour. "Reset order" shows once an order is set. Order and view live in this
  browser's `localStorage` only (`kybernos.suite.order.v1`, `kybernos.suite.view.v1`); a blocked
  `localStorage` is tolerated and the panel then says the order is not saved.
- **Updates.** *Check for updates* asks the signed online catalogue (nothing unsigned is ever shown); a newer suite offers *Update the suite*, which
  installs the whole suite with the lifecycle robot (one restart). A development checkout is updated with git, never by this. See `docs/dev/suite-updates.md`.
- **Switch.** Saves the intent on the host, then asks the native manager. Base modules cannot be switched.
- **Plugins.** A sixth tab, shown only when the plugin registry (`kybernos-registry`) answers. It lists the **plugins made by other people** that DSH's manager installed (plain data), as cards or rows with level, kind, price and state,
  kind chips and « Needs attention », search, a page per plugin (*Description*, *Permissions*, *Compatibility*, details, *Remove*) and **Add a plugin** (GitHub or npm, a folder path or a `.tgz` archive, drafts the AI made with the `plugin-creator`
  skill, and « Create with AI »; the catalogue is greyed for phase 3). *Read and accept* shows everything a plugin brings before it reaches an agent. The switch, the install and the removal are DSH's own manager (`inspect`, `installBundle`,
  `removeBundle`, `setBundleEnabled`); the page writes only the person's acceptance. See `docs/dev/plugin-contract.md` (section 14, « The Plugins segment as built »). Code: `construirePlugins` in `client.js`, its pure helpers between `KB-PLUGINS-PURE-BEGIN` and `-END`.

## Host routes

Same-origin only: a POST needs an `Origin` or `Referer` of the local server; a GET may carry none. Every POST except the boot beacon also needs DSH's signed session cookie
(`session-guard.mjs`, `test-write-guard.mjs`, `docs/dev/route-origin-rule.md`): 401 without it, and 403 `refused_on_phone` through the phone link. The Suite panel and Maintenance send it by themselves.
The beacon stays at the Origin alone: it is the crash detector and must not depend on the session it exists to survive.

| Route | Purpose |
|---|---|
| `GET /kybernos-hub/state` | boot verdict and recommendation |
| `POST /kybernos-hub/beacon` | `{type, bootId, entries?}` from the client |
| `GET /kybernos-hub/suite` | catalogue, which modules are switched on, hub state |
| `POST /kybernos-hub/catalogue/refresh` · `POST /kybernos-hub/update` · `GET /kybernos-hub/update/status` | the signed online catalogue and the whole-suite update: see `docs/dev/suite-updates.md` |
| `POST /kybernos-hub/module` | `{id, action: activer \| desactiver \| installer}`, one at a time (409 if busy) |
| `POST /kybernos-hub/relaunch` | `{confirm: true}` only: starts `~/.dsh/tools/dsh-relance.mjs` detached, or the suite's `scripts/dsh-relance.mjs` when there is no such copy (`outilRelance`) |

## Files and install

Reads `catalog.json` (shipped). Reads and writes `boot-state.json` and `satellites-actives.json`
in `~/.dsh/kybernos/` (`DSH_HOME` overrides `~/.dsh`); the second is the activation file the
lifecycle robot reads too (atomic write; no file = everything on).

"Install" writes the module into the activation file, then runs `scripts/dsh-lifecycle.mjs install`
from the repo (10 min timeout; refused if the robot is missing). The robot takes a safety snapshot,
links the bundles, installs the profile, re-applies the engine patches, checks the boot and restores
the snapshot on failure. The hub never passes `--restart`: the card reads "Active after restart"
and a banner offers a confirmed "Restart DSH".

## Tests

Run `for t in test*.mjs; do node "$t"; done` in this folder: `test-boot-guard.mjs` (verdicts, safe mode),
`test-host.mjs` (routes, client beacons), `test-suite-host.mjs` (activation, install, routes),
`test-suite-order.mjs` (order and view helpers), `test-suite-store.mjs` (catalogue sheets, Featured, family filters, the update words and wiring), `test-suite-plugins.mjs` (the Plugins tab: helpers, every component drawn in both languages, the page's calls against the registry's routes), `test-catalogue-distant.mjs`, `test-telechargement.mjs`, `test-suite-update.mjs` (the signed catalogue and the update). `scripts/test-suite-gui.mjs` renders the real panel in a
browser (needs Playwright and React 18; skipped otherwise).

## Engine fix route

`POST /kybernos-hub/engine { confirm: true, version }` puts the DSH engine on a version this plugin was TESTED with, in one click (the
*Fix automatically* button of the update dialog). Strict same-origin JSON POST with the session cookie, explicit confirmation, 202 then the shared
`GET /kybernos-hub/update/status` (`etat: installation | termine | echec`, `moteur: true`). The version is accepted only when it lies inside
the `min`..`max` zone of the shipped `dsh-compat.json` (`409 outside-tested-zone` otherwise, nothing runs; `400 bad-version` for anything that is
not a plain version; `409 hosted-instance` on a server or container; `409 busy`). The work is `deps.executer(['upgrade', version])`: the lifecycle
robot, snapshot first, rollback on a failed boot. `node packages/kybernos-hub/test-engine-route.mjs`.
