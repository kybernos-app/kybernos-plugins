# kybernos-maintenance — the About page

A DSH bundle that adds one Settings section: **About** (French: **À propos**). It merges the identity of
Kybernos with the health of the installation. The section id is still `kybernos-maintenance` (order 13), so
stored state and tests keep working; only the visible label and title changed.

## What the page shows

- **Identity**: the Kybernos wordmark, `Version 1.0.0-beta.1` (the exact shipped version), and a **Check now** button.
  The wordmark comes from `window.__KB_BRAND__.Wordmark` (shared brand component); when it is absent or
  throws, the page falls back to the plain text "Kybernos".
- **Status**: one block, green or orange (blue for "engine ahead", red for out of range), with a one-line
  verdict and, when an update is advised, **Copy the command** (`node scripts/dsh-lifecycle.mjs upgrade`).
- **Three numbers**: DSH engine (installed), Kybernos (the shipped `VERSION`, else the git hash), Tested zone
  (`dsh.min → dsh.max` of `dsh-compat.json`).
- **Links row**: licence, trademark policy, modules. Plain text on purpose: `LICENSE` and `TRADEMARK.md` are
  not in the archive, no host route serves them, and nothing in this repo jumps to another Settings section
  (`layout.selectPanel` opens panels, not Settings sections).
- **Technical details**: one collapsed disclosure (open or closed is kept in `localStorage`
  key `kybernos.maintenance.details`, closed by default) holding the four stat cards, the last operation,
  earlier updates, the update procedure, the plugin contract, the per-version compatibility matrix and the
  engine surfaces audit.

## Host routes

`GET /kybernos-maintenance/state` (`index.js`). Other methods get 405; an `Origin` header that is not the
local host and port gets 403.
It measures, and never writes: `dsh --version`, `git rev-parse --short HEAD`, `npm root -g`, and
`npm view @deepseek-ai/dsh version dist-tags` (cached for 10 minutes). The answer carries `global` (engine),
`plugin` (git hash), `version` (shipped semver or null), `problemes`, `niveau`, `compat`, `maj`, `distant`,
`versions`, `surfaces`, `serveur`, `journal`. The sentences and the level words (`Perfect`, `Compatible`, `Partial`,
`Out of range`, `Unknown`, `None`, `Possible`, `Recommended`, `Required`) are English: the host has no French. A French page
shows them through the client's French tables (`FR_HOST`, `FR_HOST_RX`, `FR_LEVEL`); every other language reads the English.

`GET /kybernos-maintenance/update` is the update notice: the Kybernos version published on GitHub (cached 1 h) and the DSH
engine measure above. The page asks it ~15 s after it opens, every 6 h and when the tab comes back (`?auto=1`), and the person
asks it with **Check now** (no `auto`).

`GET|POST /kybernos-maintenance/settings` is the one switch of this bundle, **Check for updates automatically** (card on the
About page, ON by default): `{ autoCheck: boolean }` in `$DSH_HOME/kybernos/update-check.json`, written atomically, nothing else.
A POST needs the browser's `Origin`. OFF, a scheduled check (`auto=1`) answers `{ ok: true, desactive: true }` without asking
anybody and the page then skips the Suite's catalogue refresh too; **Check now** and the Suite's own button always ask. What leaves
the machine, and when: [`docs/privacy.md`](../../docs/privacy.md).

## Files it reads

- Repo root (two levels above the bundle): `dsh-compat.json`, `VERSION`, `scripts/lifecycle-packages.json`.
  `scripts/paquet.mjs` writes `VERSION` at the archive root, so a tester without a git checkout still has it.
  `version.mjs` accepts it only if it is a semver.
- `$DSH_HOME` (default `~/.dsh`): `profiles/web/package.json`, the mtimes of `profiles/web/pnpm-lock.yaml` and
  `profiles/web/node_modules/.modules.yaml`, and `lifecycle/journal.jsonl` (the 12 newest entries).
- The installed engine under `npm root -g`: its `package.json` mtime, and the package files probed by
  `surfaces.mjs` (plus the `*.orig` backups our patches leave next to them).

## Files

`index.js` host route · `client.js` page (React, bilingual: `FR`/`EN` tables, `kt(fr, en)`, `FR_HOST`/`FR_HOST_RX`/
`FR_LEVEL` for the host's sentences and levels) · `surfaces.mjs` engine audit (also used by `scripts/dsh-lifecycle.mjs`) · `version.mjs`
reads `VERSION` · `test-about.mjs` tests · `cordis.patch.yml`, `package.json` bundle wiring.
The bundle is an optional satellite (`obligatoire: false` in `docs/beta/satellites.json`).

## The update dialog (no terminal)

The account menu, the card at launch and the *Update available* dialog share `window.__kbUpdate`. What the dialog offers:

- **A newer signed Suite release** (and this install can apply it: not a git checkout, not hosted): *Update now* → the hub downloads,
  verifies, snapshots, installs, restarts (`POST /kybernos-hub/update`, followed on `GET /kybernos-hub/update/status`).
- **The engine is outside the zone this plugin was tested with** (an `moteur` item with a target): *Fix automatically* →
  `POST /kybernos-hub/engine { confirm: true, version }`. The hub accepts only a version inside the `dsh-compat.json` zone, runs the
  lifecycle robot (`upgrade <version>`: snapshot first, boot check, automatic rollback), then the dialog restarts DSH through
  `/kybernos-hub/relaunch`, exactly like the Suite update. The terminal command stays in a folded *For developers* section.
- A hosted instance (server, container) is rebuilt, never patched: it keeps the instructions, no button.

Tests: `test-engine-dialog.mjs` (the words and the wiring), and `packages/kybernos-hub/test-engine-route.mjs` (the route).

## Tests

```bash
cd packages/kybernos-maintenance && node test-about.mjs
```

It runs the real `client.js` against a tiny React stand-in (no dependency) and checks the label, the
above-the-fold content, the disclosure and its memory, that nothing from the old page is lost, and that a
missing or broken brand component, throwing storage or a failed fetch never crash the page. With `react` and
`react-dom` on `NODE_PATH` it also renders the page with the real React. Also relevant:
`node scripts/test-layout.mjs` (repo-root files this bundle reads) and `node scripts/test-paquet.mjs`.
