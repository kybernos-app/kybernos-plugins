---
name: dashboard-sources
description: Explains what data a Kybernos dashboard can show: the local sources, their columns, which ones have a period filter, and what is not available yet. Use it before choosing fields for a widget or when the user asks for data that may not exist.
whenToUse: The user asks what a dashboard can show, asks for a number from an app or service, or you need to pick the right source and field for a widget.
---

# Dashboard sources

A dashboard widget reads ONE source: a provider id plus a few parameters. The sources run
on this computer and read what DSH already holds. Get the exact list and columns from
`kybernos_dashboard` with `catalogue: true`; this page tells you how to choose.

## What the sources are

| Need | Source | Notes |
|---|---|---|
| Tokens used, by day, model, provider | `usage.daily` | has a period (`days`); tokens, not money |
| Which sessions used the most | `usage.sessions` | has a period; newest 40 |
| Totals of the period by model, with the share of each | `usage.models` | has a period; one row per model; for a table or a "favorite model" card |
| Sessions, active days, tokens, models used in one row | `usage.totals` | has a period; one row; sessions are counted in full, not capped at 40 |
| What automations did | `automations.runs` | last 20 runs kept per automation; has a period |
| State of each automation | `automations.list` | last result: done, failed, none, paused |
| What is planned or happened this week | `automations.timeline` | past runs and planned runs, Monday to Sunday |
| Agent Teams, roles, skills | `teams.list` | no period: current state |
| What teams learned | `teams.lessons` | no period |
| Installed skills | `skills.list` | no period |
| Sessions that carry runs | `sessions.runs` | no period |
| Files the teams produced | `deliverables.list` | no period |
| The rows of any table made on the Tables page (contacts, properties, deals, products, anything) | `db.rows` | no period; `object` is the table's key, `db` the database (its id, or the id of the template it came from; the first one if left out); the table's own fields are columns under their key: a choice also gives `<key>_key` and a label, a relation the titles it links to, a date `<key>_in` / `<key>_ago`; `order` (a choice field) keeps its options in order on a chart, `diff` (`"stock,reorder_at"`) adds the column `stock_minus_reorder_at` |

## Honest limits

- **Money is not stored**, only tokens. If the person asks for a cost, say that the Usage
  page prices tokens when it draws them and that a dashboard shows tokens.
- **A source without a period shows the current state.** When the person asks for "the
  last 30 days" of such a source, say it cannot be filtered by period.
- **Messages and the busiest hour are not measured.** The usage ledger keeps tokens per day,
  model and session, nothing about messages or the time of day. Do not invent them.
- **Automation history is short**: each automation keeps its last 20 runs.
- **The Tables source holds what the person put there, nothing more.** A row has the day it was added and changed, not a history
  of stages, so "time in stage" is never a trend. A column can be empty (a property without a mandate date):
  add `not_empty` to `where` before an average, a minimum or a maximum. A date also comes as a number of days
  (`mandate_until_in`, `due_in`: days until it, negative once past; `opened_ago`: days since it) because a filter compares numbers.
  The sample rows a template brings have `demo` = `yes`: say so when a number is made of them.
- **Connected apps are not sources yet.** If someone asks for Stripe, GitHub, Gmail or a
  calendar, say that dashboards read local data for now, and offer the closest local
  thing. Never put a made-up number in a note to fill the gap.

## Choosing fields

- Group by a `date` column (`day`) for time; by a `string` column for categories.
- A number can only be summed, averaged or compared on a `number` column; use `count` to
  count rows and `distinct` to count different values.
- `state` columns hold `done`, `failed`, `queued`, `upcoming`, `paused` or `none`: use them
  for the dot on a list, the colour of a calendar event, or the columns of a kanban.
