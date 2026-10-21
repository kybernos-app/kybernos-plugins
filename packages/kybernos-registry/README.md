# `@local/kybernos-registry`

The registry of plugins: it reads the **data plugins** installed on this computer, checks them, and gives the owner of an extension point what they
contribute. It also publishes the one versioned seam other bundles use, `window.__KB__`. Specification: `docs/dev/plugin-contract.md` (sections 5, 6, 14).
Phase 2 of the contract: no page yet (the page is designed in the Plugins mockup and comes next), no catalogue, no key.

## What it does

- **Reads** `<DSH home>/kybernos/plugins/<author>/<name>/plugin.json` and the files of each `extends[].dir`. Only `local/<name>` folders are read for now
  (a folder you placed yourself); a plugin of another author arrives with the signed catalogue.
- **Checks** each manifest with the schema (`plugin.schema.json`, the same file the dev scripts use) and the rules of the contract, then each contribution
  with the validator the owner of the point registered. Anything that fails is listed with its reasons and left out; it never stops DSH from starting.
- **Statuses**: `ok`, `disabled`, `needs-kybernos`, `needs-dsh`, `missing-dependency`, `incompatible-point`, `invalid` (`revoked` comes with the catalogue).
  A plugin seen for the first time is **off** until it is switched on; the choice is kept in `<DSH home>/kybernos/plugins-state.json` (0600).
- **Never runs anything** from a plugin folder: no import, no eval, no fetch, no symbolic link followed, every file read as bounded text and parsed as JSON.

## The two seams

Host (another bundle's `index.js`, no import between bundles): `globalThis[Symbol.for('kybernos.registry')]`

```js
const registry = globalThis[Symbol.for('kybernos.registry')]       // absent = work without it
registry?.definePoint({ owner: 'kybernos/core', ownerVersion: '1.0.0', name: 'domain-pack', version: '1.0', kind: 'data', class: 'instruction', validate })
registry?.contributions('kybernos/core#domain-pack')               // [{ plugin, level, class, file, value }]
```

Page: `window.__KB__` (created when `client.js` is evaluated): `use(id, range)`, `provide(id, version, service)`, `reason`, `extend`, `extensions`, `status`,
`plugins`, `points`, `on('change', fn)`, `refresh()`. `use` answers `null`, never an error; a bundle keeps its old global as a fallback.

## Routes

| Route | |
|---|---|
| `GET /kybernos-registry/state` | the plugins found (with status and reasons) and the points defined |
| `GET /kybernos-registry/contributions?point=owner/name%23point` | what the enabled plugins give one point |
| `POST /kybernos-registry/enable` `{ id, enabled }` | switch a plugin on or off: strict same origin **and** DSH's signed session cookie |

## Files

| File | Role |
|---|---|
| `registry.mjs` | pure: the folder scan, the statuses, the contributions, the on/off state |
| `manifest.mjs`, `schema-subset.mjs`, `plugin.schema.json` | the manifest validator and the JSON Schema subset it runs on (`scripts/plugin-manifest.mjs` re-exports them) |
| `version.mjs` | comparison and ranges of the contract's grammar |
| `host.mjs`, `index.js` | the routes and the host seam |
| `client.js` | `window.__KB__` |
| `session-guard.mjs`, `lib-session-test.mjs` | copies of the terminal's guard and its test helper (`scripts/test-session-guard.mjs` compares them) |

## Tests

`node test-version.mjs && node test-registry.mjs && node test-host.mjs && node test-write-guard.mjs && node test-client.mjs`: the grammar, the scan and the
statuses, a hostile folder (symbolic links, oversized files, a `__proto__` key, a script next to the manifest), the routes and the Host fence, the write guard,
and the seam in the page. `test-registry.mjs` also keeps `docs/dev/schemas/plugin.schema.json` identical to the bundle's copy.
