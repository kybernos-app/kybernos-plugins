# kybernos-db

The engine for user- and agent-defined databases: objects (Tasks, Orders, Contacts…), typed fields, relations and views. It replaces the three fixed
engines (Contacts, Catalog, Pipeline) in phase A; "task management" is one more object, not a plugin.

This folder holds **lot 1 only: `core/`, the rules, with no disk, no network and no clock.** The storage (lot 2), the agent tools (lot 3), the toolbar
and views (lot 4), relations (lot 5), attachments (lot 6) and the replacement of the old engines (lot 7) come next and import this core.

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

## What is not here yet

Storage (SQLite, ULID generation, the operation journal), the agent tools and the `db-builder` skill, the toolbar and the page, relations between objects
as a catalog (the field type exists, the inverse links do not), blob storage, sync, and team rights (`can()` refuses everyone but the owner).
