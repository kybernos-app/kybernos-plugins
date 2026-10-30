---
name: db-builder
description: Build, extend and use the person's own databases (tasks, customers, orders, a collection, a budget…) with the db_* and records_* tools — design the tables and fields from a sentence, link them, protect personal data, save views, then fill and query them.
whenToUse: Load when the person wants to keep track of something in a table ("track my tasks", "a list of my customers and their orders", "a place for my recipes"), asks to add a column, a link or a view, or asks a question about data already in one of their databases. Read db_list first, always.
---

# Building and using a database

A database here is a small file on the person's computer: **tables** (the tools call them *objects*), each with typed **fields**, **records** (the rows), and saved **views** (ways of looking at a table). The person never edits the structure by hand: you do, from what they tell you, and they approve each change on a card that shows the before and after. So the structure is worth getting right the first time.

## 1. Look before you build

Call `db_list`. It shows every database, table, field and view with the exact keys the other tools need. Then:

- a table for this already exists → use it (add a field or a view if something is missing), do not make a second one;
- no database yet → `db_create` (one is enough for most people: "Home", "My shop"), then build inside it;
- several databases → name `db` on every call.

## 2. Design from the person's sentence

Ask at most one or two short questions, and only about what you cannot guess: what a row *is*, and what they want to find or count later. Then design the whole table before calling anything:

- **One row = one thing** (a task, a customer, an order). A list of things inside a row is another table, linked.
- **Title**: the text field that names a row. Put it first.
- **Types** (never changed afterwards, so choose carefully): `text`, `longtext`, `number`, `money` (give `currency`), `date`, `checkbox`, `choice` (one of a fixed list), `multichoice`, `person`, `url`, `email`, `phone`, `relation` (a link to another table), `attachment` (files).
- **Choice rather than free text** for anything the person will filter or group by (status, priority, kind). Give every option a stable lower-case `key` and the `label` they read.
- **Required** only for what a row cannot exist without (usually just the title). A field cannot be made required once the table has rows.
- Fields are **never deleted or retyped**. A field you add by mistake stays: say so before adding it. Labels, protection and new choices can change later with `field_update`.
- Keys are lower-case, digits and `_`, in English even when the labels are in the person's language (`due`, `status`). Labels are in the person's language.

## 3. Protect personal data when you create the field

Every field has a protection. Pick it when you create the field; the person can raise or lower it later, you can only raise it.

| Level | Use for | What you see |
|---|---|---|
| `normal` | titles, statuses, dates, quantities | clear text |
| `personal` | names, emails, phones, addresses of people | masked (“•••• 1234”) until the person approves |
| `sensitive` | amounts owed, salaries, bank details, health | masked until approved |
| `secret` | passwords, API keys, tokens | never shown to you at all |

When in doubt about a field holding something about a person, make it `personal`. Say in your answer which fields you protected and why. Do not put a secret in a normal field to be helpful, and never ask for a secret you do not need.

## 4. Create the structure

1. `object_define` with the table and all its fields at once (one card for the person to read, not ten).
2. `field_add` when the table already exists and one more column is wanted (one card; the existing rows stay empty on it).
3. `relation_add` for each link between tables, after both tables exist: a task has one project (`many` false); an order has many products (`many` true). A link is written on the table that holds the pointer.
4. `view_save` for the views they will use first: a board by status for tasks, a calendar on the due date, a table sorted the way they read it. A view is free to create; the person can change it.
5. Tell them in one or two lines what now exists. Do not paste the structure back: the card already showed it.

If the person asks for something the engine refuses (a retype, a delete), say so plainly and offer the nearest thing: add a new field, hide the old one in the views, relabel it.

## 5. Fill and change records

- `records_create` takes a list (up to 50) of `{ field key: value }` maps. Values are exact: numbers are numbers, dates are `"YYYY-MM-DD"`, a choice is the option **key**, a multichoice is a list of keys, a relation is the **id** of the linked record (look it up first with `records_list`), empty is `null`. Nothing is coerced: `"12"` is not a number.
- The answer lists what was created and what was refused with the reason: fix the refused ones and send them again, do not retry the ones that worked.
- `records_get` reads one record by id (to check it before changing it).
- `records_update` changes only the fields named. `records_delete` hides a record and `records_restore` brings it back: nothing is lost, so delete when asked without a long warning, and say it can be undone.
- Importing many rows: batch by 50, tell the person how many went in and how many were refused.

## 6. Answer questions from the data

Use `records_list` with a `filter` and `sorts` instead of reading everything and counting by hand. A saved view's filter and sorts apply when you pass its id as `view`. The `total` in the answer is the real count, `count` the page you got; read the next page with `offset` when you need it.

A protected field comes back masked and a secret one is left out; you can still **filter and sort on normal fields** to answer ("tasks due this week by status"). Name a protected field in `reveal` only when the answer truly needs the clear value: the person is asked each time, so do not ask for more than the question needs.

## 7. What not to do

- Never write SQL or touch the database file. If a tool cannot do what is asked, say what is missing.
- Never create a second table for something that already has one, or a field that duplicates another one.
- Do not invent records to make an example look full, and do not fill a protected field with made-up data.
- Do not repeat protected values the person revealed to you anywhere but in the answer to them.
