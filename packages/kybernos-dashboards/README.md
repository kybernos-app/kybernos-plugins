# `@local/kybernos-dashboards`

Dashboards for your whole DSH: a **Dashboards** page right before Agent Teams, built and changed by chatting, with the
dashboard shown live in the right sidebar like a mini app.

## What the user sees

- **Sidebar › Dashboards** (before Agent Teams). It opens your default dashboard, or the gallery:
  *My dashboards* (Default, Clone, Archive, Hide, as in Insight) and *Presets* (templates; using one gives you your own copy).
- **Create a dashboard with AI** / **Improve with AI**: open a normal DSH chat with a ready message that names the
  `dashboard-builder` skill. The agent interviews the person (what to follow, how far back), shows a plan with the widget
  it chose for each piece of data and why, then builds it with the `kybernos_dashboard` tool.
- **The right sidebar › Dashboard** tab opens by itself when the agent writes, and updates live: new or changed widgets
  flash. *Open full page* goes to the Dashboards page.
- **Edit layout** moves (grip), resizes (− / +) and removes widgets. Notes, checklists and the cards of a manual kanban
  are edited in place. Every change is a revision (the History menu restores one).
- **Widgets**: card (count-up, sparkline, or a name: the favourite model), chart (columns, stacked, bars, line, area, donut, a calendar heatmap, each with a table view), table (rows and columns, with a colour swatch and share bars),
  calendar (a week), list (with an All / Failed filter), kanban (bound to a field, or manual and draggable), notes and
  checklists (colours), carousel, flow (nodes you drag; a node can carry a live number read from a source, `bind`), sankey.
- **Motion**: charts draw themselves when they scroll into view (bars rise with a stagger, lines draw and an end dot pings,
  donut slices sweep, ribbons flow, cards count up), with hover lifts and a crosshair on lines. Everything is off under
  `prefers-reduced-motion`.

## Where the data comes from

A widget names a **source** (a provider of `model.mjs`) and says how to show it. A source is one or two routes of this
computer, read when the page opens or you refresh. Nothing leaves the machine.

| Source | Route | Has a period |
| --- | --- | --- |
| `usage.daily`, `usage.sessions`, `usage.models`, `usage.totals` | `GET /kybernos-usage/summary` | yes (`days`) |
| `automations.runs` | `POST /kybernos/tasks {action:'list'}` | yes (`days`) |
| `automations.list` | same | no |
| `automations.timeline` | tasks + `GET /kybernos/tasks/occurrences` | the week (`weekOffset`) |
| `teams.list`, `deliverables.list` | `GET /kybernos/load` | no |
| `teams.lessons` | `GET /kybernos-sessions/state` | no |
| `skills.list` | `GET /kybernos-skills/skills` | no |
| `sessions.runs` | `GET /kybernos/runs-index` | no |
| `catalog.items` | `GET /kybernos-catalog/list` (pages of 500) and `GET /kybernos-catalog/types` | no |
| `contacts.people` | `GET /kybernos-contacts/list` (pages of 500) and `GET /kybernos-contacts/schema` | no |
| `pipeline.cards` | `GET /kybernos-pipeline/flows`, then `GET /kybernos-pipeline/board?flow=` per board (or the one named by `flow`) | no |

The three **Business sources** read the pages of Contacts, Catalog and Pipeline (the person's own items, people and cards, sample rows
included: `demo` is `yes` on those). They are read page by page, so the model has a second round: `planNext(source, answers)` returns the
requests the first answers call for (the pages after the first, up to 2,000 rows; one board per flow, up to six), and a table that stops short
says so in its note. A column is always there, `''` when the row has no value (a source here is *sparse*: add `not_empty` to a `where` before an
average, a minimum or a maximum), and the fields of an item's own type are columns under their key (an *open* source: `stock`, `surface`, `opened`…,
beside the declared ones). A field that holds a day also gives `<key>_in` (days until it, negative once past) and `<key>_ago` (days since it), and a
card gives `due_in` and `days_in_stage`, because a `where` compares numbers, not dates. Stages and statuses are in the words of the template
(`stage`, `status`), their keys beside (`stage_key`, `status_key`); with `flow` set a chart of `stage` keeps the board's order and shows an empty stage.

A source without a period shows the current state, and the widget does not pretend otherwise. Money is not stored, only
tokens, so a dashboard shows tokens. Connected apps (Stripe, GitHub, …) are **not** sources yet: see "Not built".

## Dashboards a template ships (`kybernos/dashboards#preset`)

A template (a data plugin: real estate, e-commerce, recruitment…) names the point in its `plugin.json` and ships `dashboards/<id>.json`: a name, a line,
the word of its row in the menu, and widgets over the sources above, in the words of the trade. The plugin tells the point to the registry at boot
and again until it is heard (`tellWhenReady`), checks every file with `preset-point.mjs` (the model's own validator, with nothing dropped or warned about;
no note, no flow, no address) and lists the dashboards of the **installed** templates in *Presets*, ahead of the built-in ones, with the template's name on
each card. Using one gives the person their own copy, like any preset; the copy remembers its preset (in `index.json`).

While a template ships a dashboard marked `overview: true`, the *Business* group of the menu has a first row, **Overview** (the template's own `menu` word if it
gives one), which opens the Dashboards page on the person's copy of that dashboard, made the first time, with a *All dashboards* button to the Dashboards page.
The row is declared through `window.__KB_MENU__` and its page on the keyed slot `main.kybernos-business`: no core change. The contract is in
`docs/dev/plugin-contract.md` (6.2b); `template-presets.mjs` holds `isOffered`, the one function that says whose presets are offered (the ACTIVE template's: the
Business pages show one template at a time, and the row follows a switch at once). A template extends the point as an optional extension, so until the
Dashboards plugin is on and has told its point the template stays whole and only its dashboard is missing.

## A dashboard is a file, never code

`<dsh home>/kybernos/dashboards/files/<id>.miniapp.json`, the shared creation format, so the Creations page, the chat card
and the popup can open a copy through the MiniApp door (the `dashboard` player this bundle registers):

```json
{ "kind": "dashboard", "renderer": "dashboard", "title": "Overview",
  "meta": { "version": 1, "rev": 7, "history": [ { "r": 7, "by": "agent", "at": "...", "what": "..." } ] },
  "data": [ { "version": 1, "name": "Overview", "desc": "...", "widgets": [ { "type": "card", "title": "Tokens", "source": { "provider": "usage.daily", "params": { "days": 14 } }, "metric": { "agg": "sum", "field": "tokens" } } ] } ] }
```

`model.mjs` validates it on every read and write: unknown types, sources, parameters and fields are dropped and reported,
sizes are clamped, text is bounded. `inspectDashboard` adds the warnings the agent must fix (a field that is not a column
of the source, a number asked of a text column, a widget too small to read).

Also under `<dsh home>/kybernos/dashboards/`: `index.json` (default, hidden, archived) and `history/` (the last 20
revisions of each dashboard).

A file the host cannot read (truncated JSON, not a dashboard, too large) is not dropped silently: `list` returns it in
`unreadable: [{ id, code, message }]`, the gallery names it in a notice above "My dashboards", and the agent's listing
carries it too. (Writing that id still replaces the file.)

## Host routes

All under `/kybernos-dashboards/`, served before DSH's own authentication, so each one fences the Host and the Origin
(reads: an Origin, when present, must be the page's own; writes: an Origin or Referer is required and JSON only).

| Route | Does |
| --- | --- |
| `GET state?session=&strict=1` | the dashboard a chat is working on (`strict`: never another chat's, so a page edit never opens the tab) |
| `GET list`, `GET presets`, `GET dashboard?id=`, `GET revisions?id=` | read (`presets`: the installed templates' first, each with `template: { id, name }`) |
| `GET overview` | which dashboard the Overview row opens (`null`: no installed template ships one), its words, and the person's copy if there is one |
| `POST save {id, dashboard, what, expectRev}` | the person's edit; a stale `expectRev` is a 409 |
| `POST preset {preset, name?}`, `POST clone {id}`, `POST flags {id, hidden?, archived?, default?}` | gallery actions |
| `POST overview-copy` | the person's copy of the Overview's dashboard, made the first time (its own path: the web server takes one handler per path) |
| `POST open {id, session}`, `POST restore {id, rev}` | open in the pane, restore a revision |

## The agent's tool and skills

`kybernos_dashboard`: list, read back (with warnings and what the person changed since), write (`dashboard`), patch
(`ops`: add, update, remove, move, meta), start from a `preset`, or ask for the `catalogue`. Its description is generated
from the same tables the validator uses, so it cannot drift from what is accepted. The skills `dashboard-builder` (the
interview, the widget to pick for each kind of data, the plan, the checks) and `dashboard-sources` (what exists, the honest
limits) are seeded into `<dsh home>/skills` on start; a copy the person edited is never overwritten.

## Files

| File | Half | Role |
| --- | --- | --- |
| `model.mjs` | both | Pure: providers, widget schema, validate, inspect, query, shapers. No DOM, no disk, no import. |
| `chart-core.mjs` | both | Pure: scales, layouts (columns, bars, lines, donut, heatmap, sankey, flow) and motion maths (easings, count-up, stagger). |
| `preset-point.mjs` | host | Pure: the point `kybernos/dashboards#preset` (the check of a template's dashboard). |
| `template-presets.mjs` | host | Pure: the presets of the installed templates, `isOffered`, the Overview's pick and word. |
| `presets.mjs` | host | The shipped dashboards, as data: usage, automations health, Agent Teams, workspace pulse, three that show a live flow and sankeys (automation pipeline, skill to deliverable, token routes) and two that rebuild the overview and the models views of a usage page (usage overview, usage by model). |
| `dashboard-host.mjs` | host | Files, revisions, flags, the tool. No `ctx`: everything is injected. |
| `index.js` | host | Wires DSH services: the tool, the guarded routes, the skills. |
| `src/plugin.js`, `client.js` | client | The page, the pane, the player, the painters and the stylesheet. `client.js` is **generated** by `scripts/build.mjs` from `src/plugin.js` and the two pure modules. |

## Tests

```bash
cd packages/kybernos-dashboards
node scripts/build.mjs        # client.js, after any change under src/ or the two pure modules
node test-model.mjs && node test-chart-core.mjs && node test-presets.mjs && node test-point.mjs && node test-host.mjs && node test-client.mjs
```

`scripts/test-business-dashboards.mjs` (repo level) installs each shipped template in a temp profile read by the real registry, seeds its sample rows into a real base, answers the
routes with the real Catalog, Contacts and Pipeline code, draws every widget of every template dashboard and checks each number on a card against a direct count of the sample file.
`scripts/check-business-dashboards-live.mjs` does it on the real GUI of a sandbox (screenshots included).

`scripts/check-dashboards-render.mjs` (a `check-*`: it needs a Chromium and React from a node_modules, so CI does not run
it) renders the real client in headless Chromium against the real host logic, takes screenshots and checks the motion.

## Not built (and why)

- **External sources** (Stripe, GitHub, Gmail, a calendar). Connected apps are reached through the server's
  `connections_execute`, which today is an agent tool only: there is no read-only route a page can call, and the contract
  carries no read-only marker. A dashboard must never be able to trigger an action, so the design is to pin one tool and its
  parameters per source, after the person approves a preview, and have the file reference only that id. That needs a
  read-only execution route in the cloud bundle first.
- A context variable (one dashboard read for another Agent Team, as Insight does per team).
- Scheduled snapshots through Automations, and a trend history for sources that have none.
- Atlas and a map as widgets.
- Messages and the busiest hour of the day (the usage page of an editor shows them): the usage ledger keeps tokens per day, model and session only, so there is nothing to read. Recording the hour of each observation would give a busiest hour from that day on, not a history.
