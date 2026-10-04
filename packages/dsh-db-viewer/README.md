# `@local/dsh-db-viewer`

A read-only SQLite viewer in DSH's right sidebar: it shows the small database a kyber keeps
(`donnees.sqlite`) as a diagram, charts, tables and a SELECT box. Nothing can be written from the page.

## What the user sees

A right-sidebar tab type titled "Base de données" (kind `dsh-db-viewer`). It has a database picker (one
entry per kyber that has a database), a refresh button and four views:

- **Diagramme**: entity cards with a coloured header, type / column / PK / KEY rows and crow's-foot links
  drawn from the foreign keys. Cards can be dragged; positions are not saved.
- **Graphiques**: counters (tables, rows, relations, columns) plus ECharts cards built from the data: rows
  per table, then a bar, line or distribution chart picked from the column types (first 4 tables, 200 rows each).
- **Données**: one table at a time as a list. If the database has a `pack` table whose first row holds a
  JSON manifest with an `entites` list, entities also get **Cartes** (logo and audio columns) and
  **Calendrier** (a date column) views.
- **SQL**: one `SELECT` / `WITH` / `PRAGMA` / `EXPLAIN` statement and its result.

## Host routes

All `GET`, JSON. Errors are `400 {erreur}`; a request whose `Origin` is not the socket's own loopback
`host:port` gets `403` (a request with no `Origin` is accepted).

| Route | Returns |
| --- | --- |
| `/dsh-db-viewer/bases` | `{bases: [{id, tables: [{nom, compte}]}]}` |
| `/dsh-db-viewer/schema?base=` | `{tables: [{nom, compte, colonnes}], relations: [{parent, enfant, colonne}]}` |
| `/dsh-db-viewer/rows?base=&table=&limit=` | `{colonnes, lignes, compte}`; limit defaults to 50, capped at 500 |
| `/dsh-db-viewer/query?base=&sql=` | `{colonnes, lignes, compte}`; no row cap |

`base` must match `^[a-z0-9][a-z0-9-]*$` (the page never passes a path) and `table` `^[A-Za-z_][A-Za-z0-9_]*$`.

## Files, settings, environment

- Reads `$DSH_HOME/kybers/<id>/donnees.sqlite` (default `~/.dsh`), opened `readOnly` through the built-in
  `node:sqlite` module. Writes nothing, has no settings and uses no browser storage. Env: `DSH_HOME`.
- The code comments say `crm.cjs` creates these databases; that script is not in this repo (not verified).

## DSH seams and network

- Host: `webServer` only (`ctx.get`, else `ctx.inject(['webServer'])`), `kind: 'exact'` routes.
  No tools, no other service, no `remote.*`.
- Client: `inject: ['slots', 'sidebarRightTabs']`. Registers the tab type with `sidebarRightTabs` and the tab
  body in slot `sidebar.right.pane.tab` through `slots.inject`. `package.json` declares the client
  dependency `@deepseek-ai/dsh-client-ui-sidebar-right`.
- Network: the page only calls same-origin `/dsh-db-viewer/*`. The Cartes view uses `src` values taken from
  database cells for `<img>` and `<audio>`, and `fetch()`es the audio URL to draw its waveform, so a database
  that holds remote URLs makes the browser reach them.

## Vendored library

ECharts 5.6.0 (Apache-2.0) in `vendor/echarts.min.js`, see `vendor/NOTICES.md`. `client/client.js` is
generated: `node scripts/build.mjs` wraps `src/plugin.js` and the vendor file in a DSH module factory.
Never edit it by hand (a rebuild reproduces the committed file byte for byte).

## Tests

```bash
node test/test-client.mjs   # 19 checks: strict ctx (inject must declare slots), layout, charts, calendar, drag
node test/test-host.mjs     # pure functions + the four routes against the real mini-CRM sample database
```

`test-host.mjs` needs `~/.dsh/kybers/mini-crm/donnees.sqlite` and exits 1 without it. Today its route part
fails: the fake request has no `socket`, so the exact-origin guard answers `403` in plain text and the test
crashes on `JSON.parse`. CI only globs `packages/*/test*.mjs`, so neither file runs there.

## Known limits

- SQLite only; no Postgres code in this bundle.
- Tables whose name is not a plain identifier are listed but cannot be opened in Données.
- The single-statement guard refuses any `;` followed by text, even inside a string literal.
- The SQL tab starts with `SELECT * FROM societes LIMIT 20` (the mini-CRM sample).
- Interface strings are French. How the user opens the tab is not verified (the code registers a tab
  type and a guide entry only).
