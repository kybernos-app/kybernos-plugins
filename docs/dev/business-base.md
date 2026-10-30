# The business base

One SQLite file per profile that Contacts, Catalog and Pipeline share: `<DSH home>/kybernos/business/donnees.sqlite`.
It is a module of the core (`packages/kybernos-plugin/business-base.mjs`), not a plugin of its own: it is always mounted, so no plugin has to
install it. It is the first lot of the business plugins: Contacts, Catalog and Pipeline are built on it.

## Rules

- **Lazy.** DSH start-up publishes the seam and nothing else. The folder and the file appear with the first question a plugin asks.
  A folder that cannot be written, a file that cannot be read, a Node without `node:sqlite`: the question answers `{ ok: false, error }`.
  Nothing throws, so a broken base never stops DSH from starting (AGENTS rule 2).
- **Reached through a seam, never imported.** `globalThis[Symbol.for('kybernos.business')]` is a frozen `{ version: 1, … }`. A plugin reads it
  when it is asked a question (not at boot) and answers `base_missing` when it is absent.
- **One writer per process.** A write is `BEGIN IMMEDIATE` … `COMMIT`; a write started inside a write joins it. Across processes WAL and
  `busy_timeout = 3000` queue the writers (measured: two writers, 0 errors, no row lost; a reader waits instead of failing). One place the
  timeout does not reach: when two processes switch the SAME new file to WAL together, SQLite answers `database is locked` at once. The base
  looks at the journal mode first and retries the switch for a few seconds (`enterWal`); without it, one of two processes failed its first
  question about one run in two while the whole suite was running.
- **The contract of the small bases.** Foreign keys on, CHECKs on closed lists and JSON shapes, no DROP, idempotent migrations ruled by
  `PRAGMA user_version`. A base written by a newer Kybernos is refused (`schema_newer`), never downgraded.
- **Definitions are not stored.** What a type, a field or a stage means comes from the registry (the active theme's contributions). A row keeps
  the key of its type; an unknown key is shown as a generic row.
- **Private.** The file is created `0600` where the platform allows it. Nothing leaves the machine.
- **Journalled.** Every write adds one line to `changes` in the same transaction: who (`person`, `agent`, `theme`, `seed`), which table and row,
  what (`create`, `update`, `move`, `archive`, `restore`, `seed`, `clear-demo`, `export`, `purge`).

## Tables (schema 2)

`contact` (person or company, `company_id`, `tags`, `fields`), `note` (on a contact, never edited), `item` (a product, a property, a job:
`type`, `status`, `price_text`, `price_num`, `fields`), `flow_card` (one card of a board: `flow`, `stage`, `position`, `value_num`, links to a
contact and an item, `entered_stage_at`), `changes` (the journal), `pack` (the manifest the DB viewer reads), `meta` (`schema_version`,
`created_at`, `seeded`). `demo = 1` marks the sample rows of a theme; `archived_at` hides a row without deleting it.
**Schema 2** adds `scope` to `contact`, `note`, `item` and `flow_card` (the plugin id of the sector template the row belongs to, `''` for none, indexed): the three Business pages show one template at a
time (`docs/dev/business-visuals.md`). The step is idempotent (a column already there is not added again), forward only, and attributes the sample rows of an older base to the theme that seeded
them by reading the journal of the seeds.

## The seam

Every method answers `{ ok: true, … }` or `{ ok: false, error, detail }`.

| Method | What it does |
|---|---|
| `status()` | where the file would be, whether it exists, whether `node:sqlite` is available. Opens nothing. |
| `open()` | creates and migrates the file if needed; `{ ok, path, version }` |
| `list(table, { q, includeArchived, demo, scope, limit, offset, …filters })` | at most 500 rows of the **active template** (`scope`: a template id, `''` for the rows of none, `'*'` for every one); filters: contact `kind`, `type`, `company_id`; item `type`, `status`; flow_card `flow`, `stage`, `contact_id`, `item_id`; note `contact_id` |
| `get(table, id)`, `create(table, row, { actor, scope })`, `update(table, id, patch, { actor })` | rows are checked (unknown keys refused, `scope` is not a field, bounded text, JSON at most 16 KB); a new row takes the active scope (a note, its contact's); `get` reads any scope; a card whose `stage` changes is a `move` and goes to the end of its new column |
| `archive(table, id, { actor })`, `restore(…)` | not for notes |
| `seed(data, { theme, actor })` | the sample rows of a theme, all `demo = 1` and with `scope = theme`, in one transaction; the same theme seeds once (`skipped`); rows point at one another with `ref`, `company_ref`, `contact_ref`, `item_ref` |
| `clearDemo({ actor, scope })` | removes the sample rows of the **active template** (every sample while none is active; `scope: '*'` all, an id that one's) and what hangs on them; what the person made stays; that theme can seed again |
| `exportAll({ actor, scope })` | everything as plain data, journal included, each row with its scope; `{ scope }` limits it to one template |
| `deleteAll({ confirm: true, actor })` | empties every table, keeps the schema, truncates the WAL and vacuums so nothing remains in the file; leaves one `purge` line |
| `counts({ scope })`, `close()`, `file()` | `counts` is the active template's rows (the answer names the `scope`; `null` = every row) |
| `scope()` | `{ ok, scope }`: the template the pages follow now (its plugin id) or `null`; opens nothing. The hosts of the three plugins read it to offer the active template's types, schema and boards only. Which template is active is `business-scope.mjs`'s: the stored choice, read through the registry |

Error codes: `sqlite_unavailable`, `cannot_open`, `not_a_database`, `schema_newer`, `read_only`, `busy`, `bad_ref`, `constraint`,
`bad_field`, `unknown_field`, `missing_field`, `bad_id`, `bad_actor`, `unknown_table`, `not_found`, `not_allowed`, `confirm_required`, `failed`.

## Seeing it

The DB viewer (`packages/dsh-db-viewer`) has a second root, `<DSH home>/kybernos/*/donnees.sqlite`, and lists this file as `kybernos-business`
(the `pack` row gives it its Contacts, Catalog and Cards entities). It is read-only and waits up to 3 s for a writer.

## Tests

`node packages/kybernos-plugin/test-business-base.mjs` (hermetic: temp folders, two child processes for the concurrency checks) and
`node packages/dsh-db-viewer/test/test-host.mjs`.
