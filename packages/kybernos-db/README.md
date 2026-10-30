# kybernos-db

The engine for user- and agent-defined databases: objects (Tasks, Orders, Contacts…), typed fields, relations and views. It replaces the three fixed
engines (Contacts, Catalog, Pipeline) in phase A; "task management" is one more object, not a plugin.

This folder holds **lots 1 and 2: `core/`, the rules (no disk, no network, no clock), and `store/`, the SQLite file with its journal and attachments.** The agent
tools (lot 3), the toolbar and views (lot 4), relations (lot 5), the attachment fields in the UI (lot 6) and the replacement of the old engines (lot 7) come next
and import these two.

## What the core knows

| File | Rule it owns |
|---|---|
| `types.mjs` | The 14 field types, `normalizeValue` (one canonical form per value), `normalizeField` (a field definition, defaults filled), the operators each type understands |
| `filter.mjs` | The JSON filter: `checkFilter` (strict), `prepareFilter` (forgiving, for a view being edited), `matches` (fail-closed, for rights) |
| `sort.mjs` | Up to three sorts; empty values last; the same order everywhere |
| `query.mjs` | Search, then filter, then sort: what a view shows and what `records_list` returns |
| `view.mjs` | A view (`table`, `board`, `cards`, `calendar`), its checks, its defaults, and `repairView` after a field is removed |
| `rights.mjs` | `can(actor, action, resource)`, the one function every door asks |
| `ops.mjs` | Field-level operations (`create`, `update`, `delete`, `restore`), `applyOp`, and the builders that diff raw values into an operation |
| `text.mjs`, `dates.mjs` | Case- and accent-folding and ordering without a locale; calendar days as integers without `Date` |

Rules that make it safe to share with a server:

- **Deterministic.** « Today » and « me » are passed in (`ctx.today`, `ctx.me`); nothing reads a clock, a locale, `Math.random`, the disk or the network.
  `test-core.mjs` greps the sources for those and fails if one appears.
- **Nothing is coerced.** `"12"` is not a number. An empty value is `null` (a checkbox is `false`).
- **A screen and a right do not fail the same way.** A view drops a half-written condition; a right treats it as false.
- **Nothing is mutated.** Every function returns a new value; the shared cases run on frozen data.

## The shared cases

`vectors/*.json` are the contract. Each file is a suite of `{ name, …inputs, expect }` cases over `vectors/fixtures.json` (a Tasks object, eight records, today
= 2026-10-30, me = noor). `vectors/run.mjs` runs them against any core and returns a `digest` of every answer, so two environments that print the same digest
answered alike. The server takes the same files in phase B.

```bash
node packages/kybernos-db/test-core.mjs
```

To check a browser, serve this folder over HTTP, import `core/index.mjs` and `vectors/run.mjs`, fetch the JSON files and call `runVectors`: the digest must
equal the one Node prints (`1abcac38` when this was written, 314 cases, checked in Chrome 152).

To add a rule: write the case first in the right suite, see it fail, then change the core. Expected values are written by hand from the rule, never copied
from what the code returns.

## The store

One db is one folder: `<dir>/<id>/db.sqlite` and `<dir>/<id>/blobs/<sha256>` (the folders are the registry: `openRegistry(dir)` lists them by reading each
db's own `meta`). The file is meant to be read by anything, not only by this code:

| Table | What it holds |
|---|---|
| `r_<object>` | One table per object, one column per field (`text` as TEXT, `number`/`money` as REAL, `checkbox` as 0/1, lists as a JSON array), plus `id`, `rev`, `created_*`, `modified_*`, `deleted_*` |
| `ops` | The journal: one row per change, in order (`seq`), with `set`/`prev` as JSON, who and when, and whether the engine or raw SQL made it |
| `catalog` | One row per version of the structure, never rewritten |
| `meta`, `ctl` | The db's id, name and author; one switch (`quiet`) that stops the triggers journaling the engine's own writes twice |

- **Through the engine** (`db.create`, `update`, `remove`, `restore`, `apply`): every change goes through the core's operations, so the row and its journal entry
  are written in one transaction, with ULID ids that sort in creation order whatever the clock does. `apply(op)` replays an operation made elsewhere, and
  applying it twice does nothing.
- **Through raw SQL** from any other connection: triggers journal it (`source: 'sql'`), keep `rev` and the stamps true, and refuse what only the engine may do
  (change an id, remove a row, edit a deleted record). `CHECK` constraints refuse a shape the engine could not read back. The operations raw SQL makes get their ids
  the next time the journal is read (`seal()`).
- **`db.verify()`** replays the journal and says whether every cell is a canonical value and the tables still agree with it: the answer to « did someone edit the
  file behind our back with the triggers off ».
- **A newer db is refused** (`db_newer`), not opened read-only: a file written by a later Kybernos is never guessed at. A file that is not a Kybernos db says so
  (`not_a_db`), and a path that is taken is never touched (`exists`).
- **Attachments** are content-addressed (`db.attach(bytes, { name, type })` gives the value for an attachment field); a blob that no longer matches its name is
  not served. Blobs are kept as long as the journal can refer to them: no garbage collection yet.

Failures a caller can cause come back as `{ ok: false, code, message, errors? }`, the core's shape; only a broken environment throws. The file uses `node:sqlite`,
loaded lazily, so a Node without it gives `sqlite_unavailable` instead of stopping the bundle that loads this.

```bash
node packages/kybernos-db/test-store.mjs
```

The store tests are hermetic (temp folders). Their strength was checked by 19 mutations of `store/` (journaling twice, no idempotence, a newer db opened, a
blob served unchecked, a delete that is silently ignored, a clock set back…): every one makes a check fail.

## What is not here yet

Removing or renaming an object or a field and changing a field's type (only adding is possible), views as stored data, the check that a relation points at a
real record, the agent tools and the `db-builder` skill, the toolbar and the page, sync with the server, the garbage collection of blobs, and team rights
(`can()` refuses everyone but the owner, and the store does not call it: the door that calls the store does).
