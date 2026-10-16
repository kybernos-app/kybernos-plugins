# Design note: cost and budget per workspace and per automation (V-08)

Status: design only, nothing built. Asked by the owner (audit 2026-10-16, V-08): « on each workspace-project and each automation,
the cost consumed and a capped budget with an alert ». Today the only budget is the single monthly one of Settings › Usage.

## What exists

| Piece | Where | What it gives |
|---|---|---|
| The usage ledger | `kybernos-usage` (`usage-ledger.mjs`, file `kybernos/usage/ledger.json`) | tokens (uncached input, output, cache read, cache write) by day and by model, and by **session** (`sessions[sid] = { title, key, last, models, first, seen }`); **tokens only, never money**: the page prices them when it draws, with the models.dev index of `kybernos-models` |
| The only budget | same ledger (`budget: { usd, alert }`) | one monthly amount for all own keys; amber chip at 80 %, banner above 100 %; **it warns and never blocks** (the README of kybernos-usage: « it warns, it never blocks ») |
| Who reports | `kybernos-usage/client.js` `reportAll` | the **browser** posts, for every session its store holds, the cumulative `tokenUsage` counters to `POST /kybernos-usage/observe`; the host books the delta (`applyObservation`: idempotent on cumulative counters, a first sight goes to `before`, a counter that goes down is a new baseline) |
| Host-side token read | `kybernos-plugin/index.js` `usageOfSession(sessionId)` | the same counters read **on the host** from the projection cache (`projCache.cachedSnapshot(meta, count, ['tokenUsage','title','modelSelection'])`), no browser needed; used today for the Calls and Runs views |
| Which sessions an automation ran | `kybernos/tasks.json`, `task.history[] = { at, sessionId, status }` | the exact session of every run; `kbFireTask` creates it with a `workspaceId` (`workspaceHint`, else the first workspace) |
| Which workspace a chat belongs to | DSH's workspace store (`workspaces.list` items carry `workspaceId` and `sessionIds`; the Atlas already reads it) and, on disk, the folder `sessions/--<workspace path>--/session-<id>` | a mapping exists, but **the ledger does not record it** |

## What is missing

1. **Attribution.** A ledger session has no `workspaceId` and no `taskId`. Nothing can be summed by project or by automation.
2. **Headless automation runs are not observed.** The ledger is fed by the browser. An automation that fires at 03:00 with no tab
   open has its session counted only if a browser later loads that session's projection. For a cap this is the main hole.
3. **No budget per scope**, and no place to store one.
4. **No enforcement point.** Nothing in the plugins can stop a chat turn (no seam intercepts a prompt; zero engine patches).
5. **Money on the host.** Prices are applied by the page. A cap decided on the host (to skip an automation) needs the same price
   table on the host.
6. **The alert** exists only as the global chip and banner.

## Proposal

**Ledger v2, additive** (the file keeps `version`; a v1 file reads as v2 with no attribution): each session gains
`workspaceId` (string or null) and `taskId` (string or null), written once, at the first observation, never changed.

- `workspaceId`: the browser knows it (the store maps session to workspace) and sends it with `observe`; the host fills it for
  sessions it observes itself from the folder name or the task.
- `taskId`: set by the host, from `tasks.json` history, for the sessions an automation started. No browser involved.
- `summarize` gains `byWorkspace` and `byTask` (the same token shape as `models`), computed on read from sessions, so
  nothing is stored twice.

**Host observation of automation runs.** After a run ends (and at each tick, for a run still going), the host calls
`usageOfSession(sessionId)` for the sessions of that task and feeds `applyObservation` with the same shape the browser sends.
Both feeders write cumulative counters into the same `sessions[sid].last`, so a session seen by both is counted once.
Open point to **measure first**: whether `cachedSnapshot` still holds a finished headless session's `tokenUsage` (a cold
session may need the durable journal path that `factFromLog` in `index.js` already reads).

**Budgets.** A `budgets` map in the same ledger file: `'workspace:<id>'` and `'task:<id>'`, each `{ usd, alert }`, plus the
existing global one. One writer: `POST /kybernos-usage/budget` gains an optional `scope`. The period is the **calendar month**,
like the global one, so the three numbers read the same way.

**Where the cap is enforced.**

| Scope | Enforcement | Why |
|---|---|---|
| Automation | **Between runs**, in the scheduler tick (`kbTasksTick`, before `kbFireTask` is called): if this month's cost of the task is at or above its cap, the run is **skipped** and written in `task.history` as a new outcome, `skipped: budget`, which the Automations page shows with the other runs; the task is not paused, it resumes next month or when the cap is raised | the plugin owns the scheduler, so this is a real stop with no engine patch. A run already started finishes: **the cap can be exceeded by one run**, and the page says so |
| Workspace | **Warning only**: the chip of the composer dock turns amber at 80 % and red at 100 % of the workspace's cap, the Workspaces card says it | no seam lets a plugin refuse a prompt; a block would need an engine patch (AGENTS rule 1). If the owner wants a hard stop, it is a request to DSH, not a plugin feature |
| Mid-run cut | not offered | needs the session controller's cancel call; check it exists before promising it (the engine's `interrupt_agent` is for children only) |

**Money on the host.** `kybernos-models` keeps the models.dev index; expose a pure `priceOf(providerModelKey)` the usage host can
call (or read the same cached file). Unpriced models count tokens, not money, and the budget view says « N unpriced tokens ».
Free and local models cost 0. The Kybernos plan (percent windows on the server) is **not** converted: plan consumption stays the
server's number and is outside these caps.

**Alert.** 80 % (the existing `alert` flag) and 100 %. Surfaces: the composer chip (existing), a line on the workspace card and in
the project header, a line on the automation row and in its editor, and a toast at the first crossing of the month. Mail and the
Telegram door are out of scope for a first version.

## Screens

- **Workspaces**: on each card « $x this month » and, if a cap is set, « 62 % of $20 ». The project settings get a « Monthly budget » field.
- **Automations**: the same on each row (the Create form keeps its fields; the budget sits under « Advanced », folded).
- **Settings › Usage**: « Where the money goes » gets two more tabs next to Models and Sessions: **Workspaces** and **Automations**.

## Order of work, each step shippable

1. Ledger v2 with `workspaceId` / `taskId` and `summarize` by scope (pure, tests in `test-ledger.mjs`).
2. Browser sends `workspaceId`; host observes automation sessions (after the measure above).
3. Usage tabs, then the chips on the Workspaces and Automations pages.
4. Budgets per scope, the alerts, then the skip-on-cap for automations.

## Risks and questions for the owner

- Pruning (120 days, 300 sessions) must keep a month of every scope: the 300-session cap is the first thing to hit a busy
  automation account; raise it or fold old sessions into per-scope day totals.
- Month or rolling 30 days? (proposed: calendar month, like today.)
- Cap in dollars only, or also in tokens for free or unpriced models? (proposed: dollars; tokens as a later option.)
- Should a skipped run notify (Telegram door, mail) or only show in the history? (proposed: history plus the toast.)
