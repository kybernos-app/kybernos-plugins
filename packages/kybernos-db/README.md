# kybernos-db

The engine for user- and agent-defined databases: objects (Tasks, Orders, Contacts…), typed fields, relations and views. It replaces the three fixed
engines (Contacts, Catalog, Pipeline) in phase A; "task management" is one more object, not a plugin.

This folder holds **lots 1 to 3: `core/`, the rules (no disk, no network, no clock), `store/`, the SQLite file with its journal, its saved views and its
attachments, and `agent/` with `index.js`, the DSH bundle that gives the agents thirteen tools, a block of their system prompt and the `db-builder` skill.** The
toolbar and views (lot 4), relations (lot 5), the attachment fields in the UI (lot 6) and the replacement of the old engines (lot 7) come next and import these.

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

## The agent

`index.js` is off by default (Suite › Tables). Switched on, it registers thirteen tools and nothing else: no route, no page, no network.

| Tool | Does | Asks the person |
|---|---|---|
| `db_list` | databases, objects, fields, views | no |
| `db_create` | a new empty database (a file under `<DSH home>/kybernos/kybernos-db/dbs`) | a card |
| `object_define`, `field_add`, `relation_add` | the structure | a card, before and after |
| `field_update` | label, new choices, a **higher** protection (never lower, never remove) | a card |
| `view_save` | create or change a saved view; what the call does not name is kept, and so is who made it | no |
| `records_list`, `records_get` | read; a protected field comes back masked, a secret one not at all; `reveal` names the protected fields to read in clear | only to reveal |
| `records_create`, `records_update` | write, up to 50 at a time, each refusal reported with its reason | only for a protected field |
| `records_delete`, `records_restore` | mark deleted / bring back (the journal keeps everything) | no |

- **One door.** Every tool goes through `can()` (`core/rights.mjs`) and the store's own functions; the agent never writes SQL and never touches the file. Its
  writes are journalled as `agent`.
- **The approval is the engine's** (`tools/pre-execute`, answered by `approvalGate`): the card is built from the call's own arguments, in English and French, and
  a call the engine would refuse anyway (lowering a protection, a duplicate field, an unknown table) is never put to the person.
- **`records_list`** takes the views' own JSON filter and sorts (`core/filter.mjs`, `core/sort.mjs`) or a saved view's id. It can only filter, sort and search on
  fields it may read in clear, so it cannot be used to guess a protected value.
- **The prompt block** (`agent/context.mjs`) names the databases, tables and fields (never a value) in a section of each agent's system prompt, the same text from
  one step to the next, empty until there is a database, cut at 3,000 characters with a pointer to `db_list`.
- **The skill** `skills/db-builder/SKILL.md` is seeded into `<DSH home>/skills` at start (never over a copy the person edited) and teaches the design rules:
  one row is one thing, choices over free text, protection chosen when the field is created, links after both tables exist.
- A database that does not open (a newer Kybernos wrote it, `node:sqlite` is missing) is reported with its code (`db_newer`, `sqlite_unavailable`…) and never
  stops DSH from starting.

```bash
node packages/kybernos-db/test-agent.mjs && node packages/kybernos-db/test-host.mjs
```

The agent tests were checked by 35 mutations (a secret field shown, a mask that leaks, a protected value that can be searched, a lowering allowed, a view that
loses its owner, an approval that is never registered, a database left open when the bundle goes…): every one makes a check fail.

## What is not here yet

Removing or renaming an object or a field and changing a field's type (only adding is possible), the check that a relation points at a
real record, the toolbar and the page, sync with the server, the garbage collection of blobs, and team rights
(`can()` refuses everyone but the owner, and the store does not call it: the door that calls the store does).
