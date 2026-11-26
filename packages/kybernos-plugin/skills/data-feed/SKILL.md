---
name: data-feed
description: Loads a CSV, an Excel sheet, a text table or the JSON of an API into the person's own Tables (a database object), converting dates, amounts, yes/no and choices, checking everything before it writes, and making a second load update instead of duplicate. This is how a sales file, a contact list or an export becomes data a dashboard can show.
whenToUse: The person gives a file (.csv, .tsv, .txt, .xlsx, .json) or pastes a table, or names an API or an export, and wants it kept, searched, charted or turned into a dashboard ("here are my sales", "import my contacts", "put this spreadsheet in a table", "update the table every week from this export"). Not for a handful of rows the person types (use records_create), not for reading a file once to answer a question.
---

# Data feed

Speak the person's language in the chat. Everything below is written in English because you read it.
The rows never travel through the conversation: a script reads the file, the `records_import` tool writes it. You decide the table, the mapping and what to tell the person.

```bash
FEED="${DSH_HOME:-$HOME/.dsh}/skills/data-feed/scripts/feed.mjs"
node "$FEED" profile <file> [--sheet NAME|N] [--path a.b] [--delimiter ';'] [--header-row N]   # look at it
node "$FEED" parse   <file> [same options]                                                    # prepare it: prints an id
```

Both print one JSON object. `{ ok: false, error, detail }` says what to fix (an old .xls, a JSON with several lists, a file over 64 MB or 50 000 rows: split it).

## 1. Look before you decide

`profile` gives, per column: how many cells are filled, a few samples, whether every value is different (`unique`), and `likely`: `number`, `money`, `date`, `checkbox`, `email`, `phone`, `url`, `choice` (with its `choices` and counts), `longtext` or `text`.
A number column may carry `decimal` ("," or "."), a date column `dateOrder` ("dmy" or "mdy"). When it says `ambiguous`, or no `decimal` can be told from values like "1,234", **ask the person**: never guess a date.

## 2. The table

Call `db_list` first. An object that already fits is used as it is. Otherwise design one with the `db-builder` skill from the profile:
- `likely` gives the field type; `money` gets the currency the person works in; the unique reference column becomes a text field you will use as `key`.
- A `choice` column becomes a choice field whose options are the values of `choices` (a label, and a lower-case key).
- Personal data (names of people, e-mails, phones, addresses) gets protection `personal`; the person sees one card for it when the import fills it.
- A column the person does not need is simply not mapped.

## 3. Prepare, check, write

1. `parse` the file. Keep the printed `id`.
2. `records_import` with `dryRun: true`: `object`, `import` (the id), `columns` (`{ "Column title": "field_key" }`, or `{ "field": "amount", "decimal": ",", "dateOrder": "dmy" }` for a column that needs telling; `decimal` and `dateOrder` at the top apply to all). Nothing is written; read the answer:
   - `refused` / `refusedRows` / `reasons`: which rows do not fit, in which column, why.
   - `unknownChoices`: values that are not options yet. Add them with `field_update` (or map the column to a text field), then check again.
   - `ignoredColumns`, `preview`: what was left out, what the first rows will look like.
3. Tell the person in one or two lines: how many rows, how many would be refused and why. Fix what you can (mapping, options, `dateOrder`); ask about the rest.
4. Same call without `dryRun`. Give `key` (a mapped, unprotected field: an order number, a SKU, an e-mail you did not mark personal) whenever the source has one: loading the same export next week then adds the new rows and updates the changed ones, and the answer says `created`, `updated`, `unchanged`.
5. If rows are still refused, nothing is written. Pass `skipRefused: true` only after the person has seen what is left out.

## 4. Where the data comes from

- **CSV, TSV, a text table**: read as it is (separator, quotes, accents and UTF-8 or Windows-1252 are detected). A pasted table: write it to a file first, then `parse` it.
- **Excel (.xlsx)**: the first sheet, or `--sheet`. Dates come out as dates, formulas as their last computed value. A title above the header: `--header-row N`. An old `.xls`: ask the person to save it as .xlsx or CSV.
- **An API**: fetch the JSON to a file with the tools you have (the person's key goes in the request only, never in a file name or in the chat), then `parse file.json --path data.items` if the list is not at the top. Several pages: put them in one JSON array or a JSON-lines file.
- **A weekly feed**: an Automation (the `automation-creator` skill) that fetches the file, runs `parse` and `records_import` with a `key`.
- **Google Sheets and other services**: export a CSV, or use the connector the person has; the result is a file again.
- A file that holds several tables (several sheets): one `parse` and one import per sheet.

## 5. Show it

The rows are in the object: the person sees them in Tables at once. For charts and totals, load the `dashboard-builder` skill: a dashboard reads an object through the `db.rows` source. Say what the dashboard shows; do not promise a public or password-protected link, that does not exist yet.

## Limits, said plainly

- A dashboard reads up to 50 000 rows of a table, the most one import loads, so its totals cover the whole file. The Tables page draws the first 5 000 rows that match: on a bigger table its search, filters and sorts are made on the whole table, so say "search for it" rather than "scroll".
- 50 000 rows and 64 MB per file; person, relation and attachment fields cannot be filled from a column (load names as text, link later with `records_update`).
- Prepared files stay 14 days in `<DSH home>/kybernos/imports/` and hold the data as it was in the file.
- A second import without `key` adds the rows again.
