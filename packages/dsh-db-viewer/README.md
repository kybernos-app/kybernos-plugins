# `@local/dsh-db-viewer`

A read-only SQLite viewer in DSH's right sidebar: it shows the small database an agent team keeps
(`donnees.sqlite`) as a diagram, charts, tables and a SELECT box. Nothing can be written from the page.

## What the user sees

A right-sidebar tab type titled "Databases" ("Base de données" in a French UI; kind `dsh-db-viewer`). It has a
database picker (one entry per agent team that has a database), a refresh button and four views:

- **Diagram** ("Diagramme" in French): entity cards with a coloured header, type / column / PK / KEY rows and crow's-foot links
  drawn from the foreign keys. Cards can be dragged; positions are not saved.
- **Charts** (Graphiques): counters (tables, rows, relations, columns) plus ECharts cards built from the data: rows
  per table, then a bar, line or distribution chart picked from the column types (first 4 tables, 200 rows each).
- **Data** (Données): one table at a time as a list. If the database has a `pack` table whose first row holds a
  JSON manifest with an `entites` list, entities also get **Cards** (logo and audio columns) and
  **Calendar** (a date column) views.
- **SQL**: one `SELECT` / `WITH` / `PRAGMA` / `EXPLAIN` statement and its result. A result is shown 500 rows at
  a time; when the query returns more, a line above and under the table says "Showing the first 500 of 200,000
  rows" and **Show more rows** doubles the page, up to 5 000 rows (then the line asks to narrow the query).

## Host routes

All `GET`, JSON. Errors are `400 {erreur}` with the message in English; the host's own refusals (empty query,
write attempt, stacked statements, unknown database or table, invalid table name) add a `code` (`empty-query`,
`read-only`, `one-statement`, `unknown-base`, `unknown-table`, `bad-table`) that the page words in the person's
language. An error of the SQL engine itself carries no code and is shown as the engine worded it.
A request whose `Origin` is not the socket's own loopback `host:port` gets `403` (a request with no `Origin` is
accepted).

| Route | Returns |
| --- | --- |
| `/dsh-db-viewer/bases` | `{bases: [{id, tables: [{nom, compte}]}]}` |
| `/dsh-db-viewer/schema?base=` | `{tables: [{nom, compte, colonnes}], relations: [{parent, enfant, colonne}]}` |
| `/dsh-db-viewer/rows?base=&table=&limit=` | `{colonnes, lignes, compte}`; limit defaults to 50, capped at 500 |
| `/dsh-db-viewer/query?base=&sql=&limit=` | `{colonnes, lignes, compte, total, tronque, borne}`; `lignes` holds the first `limit` rows (default 500, at most 5 000), `total` is the size of the whole result (counted up to 1 000 000, then `borne` is true), `tronque` says the rows were cut |

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

## Language

English is the base of every string. French is shown in a French UI (Kybernos's French, or an `fr` tag); a language the
Language page translated is looked up by its French text, and every other language reads English. The host answers its
own refusals in English with a `code` (see the routes), the page words them; dates and numbers (month names, day
letters, `200,000` / `200 000`) follow the same choice. Names that come from the database itself (tables, columns,
the titles an entity declares in its `pack`) are shown as they are.

## Tests

```bash
node test/test-client.mjs   # 19 checks: strict ctx (inject must declare slots), layout, charts, calendar, drag
node test/test-host.mjs     # pure functions + the four routes against the real mini-CRM sample database
node test-cap.mjs           # the row cap of the SQL route, on a 200 000-row table generated in a temp folder; the refusals and their codes; CI runs it
node test-language.mjs      # the whole tab rendered in English, French and six other languages, with a scripted host; CI runs it
```

`test-host.mjs` needs `~/.dsh/kybers/mini-crm/donnees.sqlite` and exits 1 without it. Today its route part
fails: the fake request has no `socket`, so the exact-origin guard answers `403` in plain text and the test
crashes on `JSON.parse`. CI only globs `packages/*/test*.mjs`, so the two files of `test/` do not run there.

## Known limits

- SQLite only; no Postgres code in this bundle.
- Tables whose name is not a plain identifier are listed but cannot be opened in the Data view.
- The single-statement guard refuses any `;` followed by text, even inside a string literal.
- The SQL tab starts with `SELECT * FROM societes LIMIT 20` (the mini-CRM sample).
- How the user opens the tab is not verified (the code registers a tab type and a guide entry only).
