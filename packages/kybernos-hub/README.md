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

A Settings section (`settings.section`, id `kybernos-suite`, order 29) listing the 26 modules of `catalog.json`
in 7 families. Installed state and switches come from DSH's native plugin manager; the DSH version from
`/kybernos-maintenance/state`, if present. A module with a `plugins.bundle.config` screen gets a Settings button.

- **Featured, then the rest.** The default tab is *Featured*: the six most advanced modules (`vedette` = rank in the
  catalogue) as larger cards with a tagline and the full description. *All*, *Installed*, *Available* and *Updates* follow.
  Family chips filter (there are no group headings), and the search matches the human title too.
- **The artwork is the module's glyph** on a tile coloured by its family (`glyphe` and the family's `couleur` come from the
  catalogue; the 32px three-tone glyphs live in the client). Cards show the human title (`titre`), the id and the version.
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

## Host routes

Same-origin only: a POST needs an `Origin` or `Referer` of the local server; a GET may carry none.

| Route | Purpose |
|---|---|
| `GET /kybernos-hub/state` | boot verdict and recommendation |
| `POST /kybernos-hub/beacon` | `{type, bootId, entries?}` from the client |
| `GET /kybernos-hub/suite` | catalogue, which modules are switched on, hub state |
| `POST /kybernos-hub/catalogue/refresh` · `POST /kybernos-hub/update` · `GET /kybernos-hub/update/status` | the signed online catalogue and the whole-suite update: see `docs/dev/suite-updates.md` |
| `POST /kybernos-hub/module` | `{id, action: activer \| desactiver \| installer}`, one at a time (409 if busy) |
| `POST /kybernos-hub/relaunch` | `{confirm: true}` only: starts `~/.dsh/tools/dsh-relance.mjs` detached |

## Files and install

Reads `catalog.json` (shipped). Reads and writes `boot-state.json` and `satellites-actives.json`
in `~/.dsh/kybernos/` (`DSH_HOME` overrides `~/.dsh`); the second is the activation file the
lifecycle robot reads too (atomic write; no file = everything on).

"Install" writes the module into the activation file, then runs `scripts/dsh-lifecycle.mjs install`
from the repo (10 min timeout; refused if the robot is missing). The robot takes a safety snapshot,
links the bundles, installs the profile, re-applies the engine patches, checks the boot and restores
the snapshot on failure. The hub never passes `--relancer`: the card reads "Active after restart"
and a banner offers a confirmed "Restart DSH".

## Tests

Run `for t in test*.mjs; do node "$t"; done` in this folder: `test-boot-guard.mjs` (verdicts, safe mode),
`test-host.mjs` (routes, client beacons), `test-suite-host.mjs` (activation, install, routes),
`test-suite-order.mjs` (order and view helpers), `test-suite-store.mjs` (catalogue sheets, Featured, family filters, the update words and wiring), `test-catalogue-distant.mjs`, `test-telechargement.mjs`, `test-suite-update.mjs` (the signed catalogue and the update). `scripts/test-suite-gui.mjs` renders the real panel in a
browser (needs Playwright and React 18; skipped otherwise).
