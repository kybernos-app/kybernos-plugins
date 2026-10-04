# kybernos-maintenance — the About page

A DSH bundle that adds one Settings section: **About** (French: **À propos**). It merges the identity of
Kybernos with the health of the installation. The section id is still `kybernos-maintenance` (order 13), so
stored state and tests keep working; only the visible label and title changed.

## What the page shows

- **Identity**: the Kybernos wordmark, `Version 1.0.0 · beta 1`, and a **Check now** button.
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

## Host route (read-only)

`GET /kybernos-maintenance/state` (`index.js`). Other methods get 405; an `Origin` header that is not the
local host and port gets 403.
It measures, and never writes: `dsh --version`, `git rev-parse --short HEAD`, `npm root -g`, and
`npm view @deepseek-ai/dsh version dist-tags` (cached for 10 minutes). The answer carries `global` (engine),
`plugin` (git hash), `version` (shipped semver or null), `problemes`, `niveau`, `compat`, `maj`, `distant`,
`versions`, `surfaces`, `serveur`, `journal`. Sentences are French; the client translates them.

## Files it reads

- Repo root (two levels above the bundle): `dsh-compat.json`, `VERSION`, `scripts/lifecycle-packages.json`.
  `scripts/paquet.mjs` writes `VERSION` at the archive root, so a tester without a git checkout still has it.
  `version.mjs` accepts it only if it is a semver.
- `$DSH_HOME` (default `~/.dsh`): `profiles/web/package.json`, the mtimes of `profiles/web/pnpm-lock.yaml` and
  `profiles/web/node_modules/.modules.yaml`, and `lifecycle/journal.jsonl` (the 12 newest entries).
- The installed engine under `npm root -g`: its `package.json` mtime, and the package files probed by
  `surfaces.mjs` (plus the `*.orig` backups our patches leave next to them).

## Files

`index.js` host route · `client.js` page (React, bilingual: `FR`/`EN` tables, `kbp(fr, en)`, `HS_STATIC`/`HS_RX`
for host sentences) · `surfaces.mjs` engine audit (also used by `scripts/dsh-lifecycle.mjs`) · `version.mjs`
reads `VERSION` · `test-about.mjs` tests · `cordis.patch.yml`, `package.json` bundle wiring.
The bundle is an optional satellite (`obligatoire: false` in `docs/beta/satellites.json`).

## Tests

```bash
cd packages/kybernos-maintenance && node test-about.mjs
```

It runs the real `client.js` against a tiny React stand-in (no dependency) and checks the label, the
above-the-fold content, the disclosure and its memory, that nothing from the old page is lost, and that a
missing or broken brand component, throwing storage or a failed fetch never crash the page. With `react` and
`react-dom` on `NODE_PATH` it also renders the page with the real React. Also relevant:
`node scripts/test-layout.mjs` (repo-root files this bundle reads) and `node scripts/test-paquet.mjs`.
