# `@local/kybernos-registry`

The registry of plugins: it reads the **Kybernos plugins DSH's own plugin manager installed**, checks them, and gives the owner of an extension point what they
contribute. It also publishes the one versioned seam other bundles use, `window.__KB__`. Specification: `docs/dev/plugin-contract.md` (sections 5, 6, 14).
Phase 2 of the contract: no page yet (the page is designed in the Plugins mockup and comes next), no catalogue, no key. It installs and switches **nothing**: DSH's manager does (the sidebar Plugins page, `dsh plugin add`, the `plugin_manager` tool).

## What it does

- **Reads** `<DSH home>/profiles/web/package.json` (`dependencies`: what DSH installed and from where; `dsh.profile.bundles`: what is selected) and, for each dependency,
  `node_modules/<name>/plugin.json`. A package with no `plugin.json`, one of our `@local/*` modules and the engine's packages are left alone. The level comes from the
  install: a `link:`, `file:` or path dependency is **Local**, anything DSH fetched (npm, GitHub, tarball) is **Unlisted**.
- **Checks** each manifest with the schema (`plugin.schema.json`, the same file the dev scripts use) and the rules of the contract, then each contribution with the validator
  the owner of the point registered. Anything that fails is listed with its reasons and left out; it never stops DSH from starting.
- **A data plugin cannot make DSH load or run anything**: its patch must be an empty list (`[]`, comments allowed), with no `dsh.client` or other `dsh` key, no install script and no
  `bin`. DSH's manager accepts such a package (verified: `dsh plugin add file:<dir>`), selects it as a bundle, and loads nothing. A package with no `dsh.bundle` is a plain dependency: also read, always on.
- **Statuses**: `ok`, `disabled` (deselected in DSH), `needs-consent`, `needs-kybernos`, `needs-dsh`, `missing-dependency`, `incompatible-point`, `invalid` (`revoked` comes with the catalogue).
  A data plugin that contributes to a point of the **instruction** class (a pack carries prompts) waits for the person's acceptance (`needs-consent`); inert data needs none.
  The acceptance is kept in `<DSH home>/kybernos/plugins-state.json` (0600).
- **Never runs anything** from a package: no import, no eval, no fetch; a symbolic link is followed only at the top (into the profile's store, or to a folder the person linked), every file is read as bounded text and parsed as JSON.

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
| `GET /kybernos-registry/contributions?point=owner/name%23point` | what the accepted, selected plugins give one point |
| `POST /kybernos-registry/consent` `{ id, accepted }` | the person accepts (or withdraws) what a plugin brings: strict same origin **and** DSH's signed session cookie. Switching on and off is DSH's |

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
statuses, a data package that tries to make DSH load code (a patch with entries, a client entry, install scripts, a bin), a hostile package (symbolic links, oversized files, a `__proto__` key, a script next to the manifest), the routes and the Host fence, the write guard,
and the seam in the page. `test-registry.mjs` also keeps `docs/dev/schemas/plugin.schema.json` identical to the bundle's copy.
