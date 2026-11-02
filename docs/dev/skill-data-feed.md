# The `data-feed` skill and the `records_import` tool

A person gives a sales file (CSV, Excel, a text table, the JSON of an API) and wants it kept in Tables and shown in a dashboard. Decided 2026-11-02: **no new screen, no change to the Dashboards plugin**. The data goes into an ordinary Tables object, and a dashboard reads it through the `db.rows` source it already has.

## Two parts, one file between them

| Part | Where | What |
|---|---|---|
| the skill | `packages/kybernos-plugin/skills/data-feed/` (seeded to `<DSH home>/skills/data-feed/`) | `SKILL.md`, the manual; `scripts/feed.mjs`, no dependency: `profile <file>` says what is in the file, `parse <file>` writes `<DSH home>/kybernos/imports/<id>.jsonl` |
| the tool | `packages/kybernos-db/agent/import.mjs` + `records_import` in `agent/tools.mjs` | reads that file **by id** (never a path), converts each cell to the field's value, `dryRun`, optional `key` for a repeatable load, then `db.create` / `db.update` row by row |

The rows never go through the conversation: 50 000 rows is one tool call, not a thousand. The script reads formats (CSV with any separator and encoding, `.xlsx` through `node:zlib`, JSON, JSON lines); the tool converts and judges, because Tables owns the field types and the engine still has the last word on every record (`normalizeValue`, then `db.create`).

The prepared file is one header line (`kind: "kybernos-import"`, `version: 1`, the columns) then `{ "r": <row in the file>, "c": [cells] }` per row. `import.mjs` documents it; a change of format changes both sides, and `test-data-feed.mjs` runs the script and the tool together.

## Rules

- **Nothing is guessed.** `05/01/2026` is refused until the order is told (`dateOrder`) or the column settles it; `1,234` is a thousand unless `decimal` says otherwise; a choice value that is not an option is refused and listed in `unknownChoices`, so the agent can add the option or map the column to text.
- **Dry run first.** `records_import` with `dryRun: true` writes nothing and says how many rows are valid, which are refused (20 shown, with row, column, reason) and what the first rows will look like. A real run with any refused row writes nothing unless `skipRefused: true`.
- **Repeatable.** With `key` (a mapped, unprotected field), a second load updates the changed rows, adds the new ones and leaves the rest (`created` / `updated` / `unchanged`). Without it a second load adds the rows again.
- **Protection.** Filling a protected field asks the person exactly like `records_create` does: `approvalGate` reads the columns of the call (the values are in the file) and puts one card. A secret field is never filled. Person, relation and attachment fields cannot come from a column.
- **Limits.** 50 000 rows and 64 MB per file; prepared files are swept after 14 days (`<DSH home>/kybernos/imports/` is `0700`, files `0600`: they hold the data as it was).

## What a dashboard shows of it

A dashboard over a Tables object reads **at most 5 000 rows** of it (`RECORDS_MAX` in `kybernos-db/api.mjs`; the table says « Only the first 5 000 rows are read »). A sales file bigger than that loads fully but its totals are wrong until that limit is lifted or the dashboard reads an aggregate: not done, deliberately outside this step.

## Tests

- `packages/kybernos-db/test-import.mjs`: every shape of number and date, the cells, the file reader, the tool (dry run, refusal, `skipRefused`, `key`, protection card, bad ids and paths, 3 000 rows).
- `packages/kybernos-plugin/test-data-feed.mjs`: the folder is seedable and uses Node only; a seeded copy runs by itself; CSV (quotes, BOM, Windows-1252, `sep=`, ragged rows), JSON, `.xlsx` (shared / inline / rich strings, date styles, 1904, hidden sheet) written by a zip writer in the test; the profile agrees with the tool's rules; the skill names only tools and arguments that exist; **a 1 200-row French sales export goes through profile, table, import, a corrected re-import and a dashboard whose cards and charts equal the sums computed from the file**.
