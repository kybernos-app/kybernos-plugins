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

A Settings section (`settings.section`, id `kybernos-suite`, order 29) listing the 25 modules of `catalog.json`
in 6 families. Installed state and switches come from DSH's native plugin manager; the DSH version from
`/kybernos-maintenance/state`, if present. A module with a `plugins.bundle.config` screen gets a Settings button.

- **Grid or list.** Grid: cards grouped by family. List: one flat row per module (grip, family
  tag, status, switch, install/update, Settings, up/down). Filters and search work in both.
- **Your order.** Drag a row, or use the up/down buttons; with a filter on, a row moves relative
  to its visible neighbour. "Reset order" shows once an order is set. Order and view live in this
  browser's `localStorage` only (`kybernos.suite.order.v1`, `kybernos.suite.view.v1`); a blocked
  `localStorage` is tolerated and the panel then says the order is not saved.
- **Switch.** Saves the intent on the host, then asks the native manager. Base modules cannot be switched.

## Host routes

Same-origin only: a POST needs an `Origin` or `Referer` of the local server; a GET may carry none.

| Route | Purpose |
|---|---|
| `GET /kybernos-hub/state` | boot verdict and recommendation |
| `POST /kybernos-hub/beacon` | `{type, bootId, entries?}` from the client |
| `GET /kybernos-hub/suite` | catalogue, which modules are switched on, hub state |
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
`test-suite-order.mjs` (order and view helpers). `scripts/test-suite-gui.mjs` renders the real panel in a
browser (needs Playwright and React 18; skipped otherwise).
