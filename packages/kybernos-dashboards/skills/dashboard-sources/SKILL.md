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
| What automations did | `automations.runs` | last 20 runs kept per automation; has a period |
| State of each automation | `automations.list` | last result: done, failed, none, paused |
| What is planned or happened this week | `automations.timeline` | past runs and planned runs, Monday to Sunday |
| Agent Teams, roles, skills | `teams.list` | no period: current state |
| What teams learned | `teams.lessons` | no period |
| Installed skills | `skills.list` | no period |
| Sessions that carry runs | `sessions.runs` | no period |
| Files the teams produced | `deliverables.list` | no period |

## Honest limits

- **Money is not stored**, only tokens. If the person asks for a cost, say that the Usage
  page prices tokens when it draws them and that a dashboard shows tokens.
- **A source without a period shows the current state.** When the person asks for "the
  last 30 days" of such a source, say it cannot be filtered by period.
- **Automation history is short**: each automation keeps its last 20 runs.
- **Connected apps are not sources yet.** If someone asks for Stripe, GitHub, Gmail or a
  calendar, say that dashboards read local data for now, and offer the closest local
  thing. Never put a made-up number in a note to fill the gap.

## Choosing fields

- Group by a `date` column (`day`) for time; by a `string` column for categories.
- A number can only be summed, averaged or compared on a `number` column; use `count` to
  count rows and `distinct` to count different values.
- `state` columns hold `done`, `failed`, `queued`, `upcoming`, `paused` or `none`: use them
  for the dot on a list, the colour of a calendar event, or the columns of a kanban.
