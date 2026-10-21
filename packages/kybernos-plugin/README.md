# `@local/kybernos` (`packages/kybernos-plugin`)

The core Kybernos bundle: agent teams (each one defined by a `kyber.yml`) with their crew views, a run journal, automations, a tools catalog, voice, a
language runtime and ~85 host routes. `client.js` (~31k lines) and `index.js` (~11k) are too big to read linearly: this page comes
from slot registrations, route tables, section banners and the tests.

It is the **socle**: `socle: true` in `packages/kybernos-hub/catalog.json`, always on, its switch locked in the Suite panel.
Socle = `kybernos-plugin`, `kybernos-hub`, `kybernos-theme`, `kybernos-sessions`, `kybernos-skills`. Satellites (switchable):
`kybernos-language`, `-models`, `-slash`, `-auto`, `-relance`, `-flow`, `-composio`, `-cloud`, `-maintenance`, `-bricks`,
`-slides`, `-modeleur`, `-miniapps`, `-computers`, `-workers`, `-modeles-locaux`, `-refs`, `dsh-mermaid`, `dsh-db-viewer`,
`dsh-media-player`.

## What the user sees

- Sidebar entry **Kybernos** (`sidebar.panellist`) opening a main panel: **Agent Teams** (gallery and Marketplace tabs, create / edit / info pages,
  Insight, Quality Score), **Workspaces**, **Creations**, **Automations** (cron, one-time and webhook tasks, as **Columns**, **Calendar** or **List**) and **Resources**
  (Connectors tab only when `@local/kybernos-composio` is booted, Skills tab, Documents tab off via `KB_SHOW_DOCS`). "Kybernos
  Hosted" is off via `KB_SHOW_HOSTED`. The Skills tab mounts the slot `main.kybernos-skills`, with a core page as fallback.
- In the chat: a **Journal** tab (`conversation.view`, runs derived from session events), team-call cards,
  composer extras (token usage, starters, widget chip, voice dictation, artifact selector), read-aloud
  buttons, share / chat-id actions. Also pinned conversations, the Kybernos brand mark and sidebar footer tools.
- Settings sections **Tools**, **Voice** and Appearance (shortcut to Theme); a first-run **onboarding** wizard (see
  « First-run onboarding » below). The account's own pages (Account, Referral, Security, Data, Support & legal) are not in
  Settings: they are reached from the sidebar footer menu (kybernos-cloud).
- **The Settings menu is grouped, and ordered for everyone** (`GROUPES` in `client.js`, by the section id each cell carries, so it holds in every
  language). **General** is a row of its own; eight **folds** follow, one open at a time (an accordion): **Models & routing** (AI provider and models,
  Auto Routing, Free LLMs, Ollama local models, Usage), **Agents** (Agent presets, Workers, Automations, Commands), **Skills & tools** (Skills, Tools,
  Connectors, Web Search), **Memory & context** (Memory & Lessons, Kybernos, Atlas), **Voice & calls**, **Interface** (Appearance, Theme, Language),
  **Devices & cloud** (Servers, Cloud computers, Phone and channels), **System** (Kybernos Suite, Built-in plugins, About, which closes the list). A group
  opens by itself when the person lands on a page inside it (a deep link, a help pointer, a search result, a click on a row of the Suite) and the open
  one is remembered (`kybernos.settings.open-group` in the browser). To move a page, move its title inside `mots`; a page not listed falls to the tail,
  before About. One icon table (`ICONES`, keyed by the page's title) draws every entry and every group header, and `test-settings-icons.mjs` checks that
  no two pages share a drawing. An always-on **language runtime** (`<kb-lang-runtime>`) keeps translated languages registered in DSH's locale
  service even when `kybernos-language` is off.
- **The main menu follows the chat's text size** (General › Font size, 12 to 17 px: the engine keeps it in `--dsh-content-font-size` on `<body>`).
  The menu's rows (`.kb4-*`), the account card (`.kbfp-*`, in kybernos-cloud) and the shell's blocks around them (logo row, Workspaces header, workspace
  and session rows, measured by `scripts/check-menu-density-live.mjs`) are drawn in em or in `calc(var(--kb-u) * n)`, so a smaller text gives a denser
  menu, and it wastes no room: at 13px the first entry starts at 97px instead of 126px, a row is 29px instead of 34px, and 11 of 21 rows of the
  workspace list show without scrolling instead of 8. *New chat* is one line (the agent it starts with follows, in a smaller size). Touch screens keep
  their 44px targets, and the collapsed rail keeps its own 36px sizes. `test-menu-density.mjs` pins the CSS.
- **Search in the Settings** reads the content of the pages, not only their titles (`<kb-settings-search>` in `client.js`: `KB_SS_INDEX`, the
  settings of every page, and `kbSsSearch`, plain functions that `test-settings-search.mjs` runs alone). It matches the label, the description, the
  words of the control, the words people use (French, English, Spanish: « police » finds *Font size*), forgives a typo in words of five letters or
  more, and shows one result for a setting that two pages both show (the mode, the text size). While a query runs the menu opens the groups with a
  match and counts them, and a panel over the page lists the settings, the page and tab they are on, and why each matched; a result opens the page,
  goes to the row and makes it blink. **Adding a page or a setting: add its rows to `KB_SS_INDEX`** with the label exactly as the page draws it (the
  last field, optional, is the text to scroll to when the page does not draw the label itself). `scripts/check-settings-search-live.mjs` opens every
  page and fails when a row's text is not there (`--lang fr` does it in French, on the sandbox only: switching the language is DSH's own setting). **Results
  read as the pages do in the language of the day**: French from `KB_SS_FR` (page|label → label, description, text to go to; the rows DSH draws in English
  even in French, such as General's Permission or Font size, keep their English text, which is what the page shows; a new row without its French line
  fails `test-settings-search.mjs`), any other translated language from a pack the index publishes to the Language page's corpus
  (`kybernos-settingsidx`, French is the source, keys from the page and the label), and English when the pack has nothing. The English words stay
  searchable in every language, a page's title is the one drawn in the menu.
- **« A short automatic state + a Customize fold »**, one helper for every settings page (`window.__KB_CUSTOMIZE__`, like `__KB_SKEL__`): a page opens on
  what already runs by itself (one sentence, one status dot) and keeps its knobs under one fold that is shut until the person opens it and that remembers the
  choice. `h(window.__KB_CUSTOMIZE__.Fold, { id: 'memory', state: 'Memory is on and tidies itself.', tone: 'on' }, …the knobs…)`;
  `read(id)` / `write(id, open)` are its store. A page of another bundle falls back to its own markup when the helper is not there.
- **The person's field of work on the pages** (`window.__KB_DOMAIN__`, read-only, see `docs/dev/domain-packs.md`): `field()`, `label(rowId)` (the menu's word for a row),
  `skills()` and `connectors()` (what the saved field and goals put forward), `installSkill(name)` (a skill this plugin ships), `openKit()`, `subscribe(fn)`.
  The Skills, Connectors and Dashboards bundles read it at each draw; without it, or with no saved field, their pages are unchanged.

## Host routes

All under `/kybernos/` (plus `/kybernos-technique/{renderer,vendor/three}.js`). Most writes check `sameOriginStrict` (loopback
`Origin`/`Referer` against the real socket port). Also an agent tool `kybernos_report_feedback` and the projection `kybernos.calls`.

| Family | Routes |
| --- | --- |
| Teams, projects | `load` `yaml` `save` `create` `ui-save` `menu-save` `active-set` `project-data` `workspace-ui-save` `workspace-skills` `pins` `share` `avatar*` `member-*` `team-portraits` `team-cap` `yml-proposer` `yml-appliquer` |
| Runs, insight | `runs` `runs-index` `calls` `calls-index` `search-content` `insight` `insight-save` `quality*` `aa` `starters-suggest` `salary-detect` (purpose not verified) |
| Deliverables | `art-origin\|read\|previews\|reveal\|raw\|action\|progress\|load` `doc-raw` |
| Automations | `tasks` (POST; scheduler ticks every 30 s), `tasks/occurrences` (GET `?from=&to=`, read-only: when the active scheduled automations will run, see "The Automations board"), `tasks/runs` (GET `?ids=&detail=1`, read-only: what each run did, read from the engine's session journals, see "The runs of an automation"), `automation-skills` (GET `?id=`: how far an automation is from becoming a skill; POST `{id}`: write it, see "Stable automations become skills"), `hooks` (public webhook: secret + 60/h default limit) |
| Tools catalog | `tools/state`, `tools/apply` (dry run, dated backup of the profile patch, restore) |
| Voice, TTS | `voice/{config,transcribe,save}` `voice-sample*` `tts/{config,voices,speak,cache,cache-trim}` (engines: `say`, `piper`, `supertonic`, `edge`, and `models`, the speaking models of the user's own providers) `models/audio` `models/audio/{probe,speak,listen}` (the audio models of the providers set up in Models, how each is asked, and using it) `image-models` (live calls moved to `@local/kybernos-call`, which speaks through `tts/speak`) |
| Widget, gateway | `widget.js` `widget/api/{config,conversations,message,account,history-delete,reply}` `gateway/{status,approvals,approvals/decision}` |
| Feedback box | `feedback` (POST: one line appended to `kybernos/feedback.jsonl`), `feedback/export` (GET: the file's content), `feedback/send` (POST: the same form posted to the linked server's relay with the device token). Strict write guard on all three (same-origin AND DSH's signed session, `session-guard.mjs`); Save and Copy send nothing, see "The feedback box" below |
| Language, static | `i18n-{translate,models,store,job,quality,packs}` `languages-pubkey.json` `icons` `icon` `onboarding` `vendor/{xyflow,leaflet}.*` `kb-places.js` |

## The Automations board

The Automations page has four views behind one switch in the shared toolbar: **Columns**, **Calendar**, **Cards** and **List**. The List is the
screen that was there before and is still the default; the choice is kept per browser (`kybernos.toolbar.automations`). Search, facets
and favourites of the toolbar apply to all four; the sort applies to the List and to the Cards.

- **Cards**: one card per automation with its name, what starts it, its mode, an on/off switch and four figures: **Last run** (relative
  time), **Success** (the share of the last 20 runs that are not recorded as failed), **Runs**, **Duration** of the last run; and the
  **Tools** the last run used. The first three come from `tasks.json`; duration and tools come from the journal of the NEWEST run of each
  automation only (one journal per card, through `GET /kybernos/tasks/runs`). A failed last run puts an orange outline and « To review »
  on the card. There is no token and no budget figure: the journals hold no token count and nothing here spends money (the Usage plugin
  owns tokens, and only for what a browser watched).

- **Columns** are states of RUNS, not a ranking (nothing is draggable): *Upcoming* (the stored next run of each active scheduled
  automation), *Running*, *To approve* (a run the engine holds for a person, then the last run of an automation when it failed, 7
  days) and *Done, last 7 days*. A webhook-only automation has no time: it is a chip above the columns. Paused ones are counted in a
  footnote, not drawn. Actions: Run now (the existing `run-now`), See session, Approve / Refuse, Retry, See journal.
- **Calendar**: a week (default) or a month of days in the browser's zone. Past runs come from each automation's `history`, planned
  runs from `GET /kybernos/tasks/occurrences`; several runs of one automation in a day fold into "name ×N". A click opens a strip with
  the run, its state and the same actions. A day of the month grid opens its week.
- **States**: skeleton while the host has not answered; the existing first-automation screen when there is none (it names the
  `automation-creator` interview); a banner with a retry when the host stops answering or when an automation is more than three
  minutes overdue (the scheduler is not running); columns and week stack on a narrow panel, the month stays a grid.

What it knows, and where from (nothing is invented; what it cannot know it says):

| Fact | Source | When it is not known |
| --- | --- | --- |
| a run, its time, "failed" and its reason | `history` of `tasks.json` (last 20 entries per automation) | a day with no entry has no run: a past slot is never drawn as done |
| a future run | `tasks/occurrences`, expanded with the scheduler's own matcher (`kbComputeNextRun`, same code as the tick) | the page shows the past and each stored next run; a note says the plan is unavailable |
| "can never fire" (a date that passed, `0 0 31 2 *`) | the same matcher, `kbNeverRuns`, with the scheduler's own message | |
| running, waiting for an approval, a question, a plan review | the engine's session status in the browser (`uiSession.sessionStatus` and `sessions.list`), the data its own sidebar shows; played live against a real engine with a stub model (`check-automations-board-live.mjs --stub-model`) | a session the page cannot see (deleted, not listed yet) is "started": no outcome is claimed and no button leads nowhere |
| ended | the engine lists the session and it is neither running nor waiting | said as "the session has ended", never as "succeeded": the board cannot read the result |

Not available: the Agent Team an automation belongs to (`tasks.json` has no such field, so the card shows its approval mode),
costs (a separate plugin will own them), a run's duration and its outcome beyond the above, and runs older than the last 20 of an
automation. Approve / Refuse answer the request the engine holds, with the same call as its own approval panel, and only exist while
that request is pending in this browser: with no page open, such a run waits (README "Automation approvals" below).

The route is bounded: a window of at most 45 days, 200 runs per automation, 1000 in all, 800 ms. A schedule too dense to list is
reported as truncated with the instant the list stops. It reads `tasks.json` and writes nothing; it has the guard of `tasks`
(same origin, signed browser session) and the Host fence of every route of the bundle. Pure logic: `automation-occurrences.mjs`
(host) and the `KB-AUTOBOARD` block of `client.js` (browser).

## The Flow of an automation, and what a node says

The Flow view of the Workflow tab is the text read as steps (numbered lines), drawn as nodes you can drag. A node shows its title on two
lines (never overflowing) and its step number; a click opens a panel beside the canvas: the type (Trigger, AI, Action, Flow), the title,
the **whole instruction** (the title is cut at 84 characters), **how it runs** (a model step is `ai.run`, an action is `tools.call`, the
same rule as the Code view), a « Guard » mark when the step starts with PREFLIGHT, Previous / Next to walk the steps, and « Edit in Text ».
Nothing in the panel is written: the text stays the source.

## Where the runs of an automation land (its workspace)

A DSH workspace is a folder the engine adopted (the page calls it a project), and a session lives in one: it is where the run's agents
work and where the files they write stay. Each automation has **one workspace choice** (the **Workspace** field of its form, where the dedicated workspace is the first option and is not listed a second time; the id is kept
as `workspaceHint` in `tasks.json`; the detail page says « Workspace: X »):

- **A workspace of the person's own**: every run lands in it.
- **No choice** (the default, and what the automation-creator skill and the templates produce): the runs land in ONE dedicated workspace,
  **« Automations »**. The host makes it on first use: it creates `<dsh home>/kybernos/automations` and asks the engine's registry to adopt it
  (`workspaceRegistry.create(path, 'Automations')` returns the workspace it already has for a folder it owns, so asking at every run is safe).
  Before this, a run with no choice landed in whichever workspace was first in the list, which was the assistant's own.
- **A workspace that was deleted** after the choice: the runs go to the dedicated one (never to a guess), and the page says so.
- **The engine cannot make a workspace** (an older registry, an unwritable folder): the first workspace of the list, as before. A run is
  never lost for this.

The rule is `automation-workspace.mjs` (pure) and `kbTaskWorkspaceId` in `index.js`; the route refuses an id that is not a plain id
(`invalid workspace`), keeps the choice when an edit does not send one, and clears it with `null` or an empty string. A copy keeps the
choice; an export does not (an id means nothing on another machine).

## Discover: templates

The **Discover** tab of the Automations page (next to **Yours**) lists ready-made starting points: ten templates in three families
(Social media, Prospecting, Customer service), as compact cards (icon, title, two lines, cadence, a tag and « +N », the apps involved,
« Import » on hover). A card opens the page of its template: a cover, what it does (the steps, model step or action), the questions the
chat will ask, what you will need, and the rules written into the steps. The data and the text of the chat are the pure `KB-AUTOTPL`
block of `client.js` (every text is an English / French pair; the other languages read the French as a key like the rest of the page).

- **A template is a starting point, not an automation.** « Import » and « Use this template » open a NEW chat (the same call as
  « Create » and « Edit in chat ») whose draft names the `automation-creator` skill, carries the template (what starts it, the draft
  steps, the questions with their options, what to connect, the rules) and asks for a real task that stays **OFF** until everything is
  connected. Nothing is created by clicking the card. The first line of the draft is « Follow this conversation in my language: French
  (fr) »: the page's language, read at the click (so it follows a change of language in DSH), named in English with its code for the model
  (`kybernos` is the French of the page); no language, no line.
- **Nothing the engine cannot do is promised.** A cap, a hand-over or a memory check in a template is an instruction written into the
  steps, not a mechanism of the engine; the scheduler has schedules, one date and webhooks, so a template that « starts on a message »
  says a webhook calls it. No template speaks of a budget or a payment: there is no runtime for them (test-automation-templates.mjs fails
  on those words).
- **The integrations show their real logos.** The apps of a template (the round tiles of a card, the **Integrations** list of its page) use the
  logos of the connectors catalogue, the one the Connections page draws: one GET of `/kybernos/composio/catalog` (the connectors plugin's
  host route), kept for the session, each SVG filtered when it is read (a plain `<svg>`, no script, handler, foreign object or external
  link) and put on a white tile. An app the catalogue does not know (Twilio) keeps its initial in a round tile, and so does every app when
  the connectors plugin is off or the host does not answer.
- **No image file is shipped.** The repository holds no media (`garde-depot.mjs`), so the cover of a template page is drawn in code (two inks on
  paper, halftone dots, a misregistered glyph), the compact cards carry no cover at all, and the logos come from the catalogue at run time.

## The page of one automation: Workflow and Sessions

The page has two tabs (the same segmented control as Yours / Discover), **Workflow** (the one it opens on) and **Sessions**. Its header keeps
**Run now** and the switch; Edit in chat, Schedule and Delete are in a « more » menu (`detail-more`). There is no Webhook tab and no Journal tab any more: the webhook
is a card of the workflow, and what the Journal said is under the run in Sessions.

### Workflow

The workflow is the numbered steps of the automation's text (`kbTaskSteps`); a text with no numbered step is one card, its whole instruction.
Flow (the cards), Text (the source, editable) and Code (read-only) are three quiet icons in the toolbar of the frame (the canvas, or the box that
holds the text or the code), Flow first, with the style button beside them; « Text is the source » is a note at the bottom of the frame.
The frame is as tall as its cards need (`fitHeight`), not a fixed height, and one step lighter than the page.

- **The cards.** A trigger (the schedule; the webhook too when the automation has one), the steps, and the record of the run. A card is told
  by its id (`schedule`, `hook`, `s1`…, `log`), so adding a webhook moves none of the others. A click opens the panel of the card: what it
  is, the whole instruction, how it runs, a guard mark for a check that must pass first, Previous / Next.
- **The webhook is the settings of its card.** Its panel has the address (hidden until « Reveal »; « Copy » copies the whole address), « Test »,
  « Regenerate » and « Revoke » (both ask first). An automation with no webhook offers « Create webhook » in the schedule's panel; creating
  it draws the card and opens its panel. The host routes are the same as before (`hook-generate`, `hook-revoke` of `kybers/tasks`).
- **What the runs used.** A strip above the canvas says, from the newest five runs whose journal was read, which model answered (and whether
  it was chosen or the profile's default), the teammates of the Agent Team with their models, the skills, the apps (connectors, with the
  logos of the connectors catalogue) and the tools, each with how many times it was seen. A step card carries the model, plus one skill, app or
  teammate its own text names; its panel has a **Uses** section (model, Agent Team, what the step names). Nothing is guessed: before a
  journal is read the strip says what it will show, and a step is never tied to a tool call it cannot be tied to. The host says it:
  `summarizeRun` (`automation-runs.mjs`) gives each call a `ref` (`skill` by its name, `app` by the server of an `mcp__<server>__…` tool, or
  the first word of Composio's tool slugs, `agent` for `spawn_teammate` / `team/member` events with the model of the spawn result, else
  `tool`) and a bounded `uses` for the whole turn. Host code: it needs a DSH restart (an older host gives the model alone).
- **The cards move.** Drag any card: the wires follow and stay at right angles. The arrangement is kept per automation, in this browser
  (`kybernos.flowpos2.<wf|run>.<id>`, an offset from the default place, so it survives a change of style); « Tidy up » puts the cards back.
- **Nine styles.** Kybernos (follows the app), Node-RED, Blueprint, Paper, Soft, Ledger, Atelier, Journey and Metrics, in a menu on the
  canvas. A style changes the cards, the wires (right angles, curves, dashes, dots), the arrowheads and what a card shows; it is one choice
  for the whole page (`kybernos.flowstyle`), shared by the workflow and the graph of a run. All of it is CSS and custom properties
  (`kbfc-*`): no library, no image.
- **Where the code is.** The layout, the routing of a wire, the offsets and the scale are the pure `KB-AUTOFLOW` block of `client.js`
  (`test-automation-flow.mjs`: no right-angle wire goes through a card of the default layout, for every style); `KbFlowCanvas` draws them.
  React Flow (`@xyflow/react`, shipped for the team view) is not used here: the wires wrap around rows, which its built-in edges do not do.

### Sessions (executions, graph, logs, and what the Journal said)

Nothing is written, nothing is guessed from what a model said.

- A line of figures (runs, failed, median duration, slowest), then the list of executions: a dot, the date, how it ended and how many tool
  calls (the newest eight, the chosen run whatever its age, then « N more »). On the right the open run: its date and a badge (how it
  ended), a line that says who ran (the model and why), how long, how many calls and whether anything asked for an approval, then its
  **graph**, drawn on the same canvas as the workflow (a card per tool call: title, duration, what it stands for, status, and on each wire the
  size of what the step handed on; more than seven tool calls show the first six and a "+N more steps" card). A card opens an
  **inspector** at its right (this run: status, think and run time, output size; what it did; what it got and gave, one line each and « Show
  raw data » for the 420 characters; what it used), and a failed run opens on the step that failed.
- Under it: what that run used (Agent Team, skills, connectors, tools; each card of the graph says what its call stands for), the
  **approvals** that were asked (nothing when none was), and the **Lessons** card: how many runs in a row the
  automation has had since its last failure, and, once that reaches the number chosen in Settings › Automations, a **Create skill** button
  (see « Stable automations become skills » below).
- A **run** is one session. `tasks.json` also keeps, for a failed run, a line the run wrote about itself afterwards (it has no session
  id): that line is a note on the run it follows (within 10 minutes, one note per run), not a run of its own. The tab counts runs.
- **The list** (the page that lists the automations) has a **Success** column: a percentage and the last ten runs as bars, from the history
  alone (the journals are not read for a list).

The Sessions tab only reads, but for that one button. Where the runs come from: `GET /kybernos/tasks/runs?ids=a,b` (at most 20 plain session ids) opens each session with the engine's own
`sessionPersistence` (`open(id, 'read')`) and summarises its **first turn** with `automation-runs.mjs`: the turn's clock, the engine's
`turn/end` reason (read as `session-outcome.mjs` does), the models the requests were routed to, whether a model was chosen on purpose,
each tool call with its think time, run time and output size, and the approvals asked and decided. `detail=1` (one id only) adds the
Input and Output of each step: control characters out, one line, 420 characters, long token-like strings and e-mail addresses masked.
Later turns of the chat are a person's, not the automation's: they are counted, not summarised. The route has the guard of `tasks`
(GET only, same origin, signed browser session) and the Host fence of every route of the bundle.

What it does not know it says: a run whose journal cannot be read (route absent on an older host, journal deleted) is "Not read",
never "Completed", and the list still shows its time and the status `tasks.json` recorded. The page asks with its own `fetch`, not
`host.call`: a 404 from `host.call` would switch every other route of the page off until it is reloaded. Pure logic: `automation-runs.mjs`
(host) and the `KB-AUTORUNS` block of `client.js` (browser).

## The List, readable schedules, and « Edit in chat »

- **The List** is one grid: the header and the button of each row share ONE column declaration (`.kba-rowhead`, `.kba-rowbtn`), the
  row's actions and its switch have the same fixed width in both, so a header always sits over its cells. The card lays itself out by
  its own width (a container query): five columns, three below 940 px (no origin, no session count), one block per row below 700 px
  (the header goes, the actions drop under the content below 520 px). The actions (Edit in chat, favorite, clone, export, delete) are at the right, shown on
  hover and on keyboard focus and always on a touch screen; a starred row keeps its star. The line under the name is how the
  automation runs (Ask me first / Always allow, notifications): `tasks.json` has no Agent Team field to show.
- **Schedules in words** (`kbCronHuman`, pure, tested): every N minutes / hours (only steps that divide the hour or the day: « every 5
  hours » would be 0, 5, 10, 15, 20, then 0 again), hourly, every day, weekdays, any one weekday, a day of the month 1-28. Anything a
  sentence cannot say exactly stays the cron expression (31st, a month, a list), and the tooltip of every schedule is its expression and
  its zone. A schedule in ANOTHER zone than the person's names it (`Every day, 08:00 (Kolkata)`); an interval has no wall clock and
  names none. Dates are one style, the board's own (`Yesterday · 08:00`, `Sat, Oct 17 · 10:00`, the year when it is not this year), in
  the person's zone and language; `kbFmtWhen` (dd/mm) now only serves the Cloud Computer card.
- **The Schedule form** has a time field next to the presets; a preset sets the days and keeps the time. A custom expression (every 6
  hours, a list) has no single time, so it shows no field.
- **A schedule that runs more often than every 5 minutes** needs a yes: `POST /kybernos/tasks` (create, and update when the cron
  changes) answers `{ ok: false, error: 'frequent schedule', everyMinutes: N }` unless the task says `confirmFrequent: true`; the
  `automation-creator` script refuses it unless the specification says `confirmedFrequent: true` (the agent adds it only after the
  user's yes). One minute stays possible once confirmed.
- **Edit in chat** (the row, and the page of an automation) opens a NEW chat the way « Create » does (`kbStartChatText`): a draft, never
  sent, that names the `automation-creator` skill, says this is an edit, and carries the automation as it stands (id, name, words and
  cron of its schedule, approvals, notifications, steps; never the webhook secret nor the history). The skill's script, given the `id`,
  replaces that automation in place (history and webhook kept, next run left to the scheduler); an unknown id writes nothing and creates
  nothing. The form stays the manual way, and is what opens if no chat can be started.

## Automations settings, and DSH's own « Automation tasks »

Settings › Automations has three switches and one choice, kept in `$DSH_HOME/kybernos/automation-settings.json` (rules in `automation-settings.mjs`):

- **Pause all automations**: the scheduler's tick does nothing while it is on. What came due fires once at the first tick after it is
  turned off (the scheduler's own catch-up); nothing is lost or skipped.
- **Show DSH's own « Automation tasks » list**: off by default. DSH's own scheduled-tasks entry overlaps the Automations page, so the
  menu hides it (the row is found by the React key `schedules`, the same in every language). It is a separate store: the tasks it
  lists are not the ones of this page, and they are one switch away.
- **Suggest skills from stable automations** (on by default: a suggestion is not active before the person accepts it; the key is still `autoSkill`) and **Stable after** (3, 5, 10 or 20 runs in a row without a failure, default 5; the
  history keeps the last 20 runs, so 20 is the most it can see): see the next section.

### Stable automations are suggested as skills

An automation that has run N times in a row without a failure is a procedure that works; it can be suggested as a skill to use by
hand in any chat. **A fixed rule, no model**: `automation-skills.mjs` counts the runs of `tasks.json` since the newest failure (a history
line with a session id is a run; a line with the status `error`, the history's own or the note a run writes about itself, is a failure).
The skill is the text of the automation (`skillParts`: description with a « Use when… », `whenToUse`, the steps), without the webhook, the history or
any secret. This half **writes no skill**: it hands the parts to the Skills page through the seam `kybernos-skills` publishes
(`globalThis[Symbol.for('kybernos.learned-skills')]`, read at call time; `docs/dev/learned-skills.md`), where they wait as a **suggestion**
until the person accepts (nothing is active before). Accepting writes `$DSH_HOME/skills/<name>/SKILL.md`, **never over an existing skill**, and the
file is the person's own afterwards. What was suggested is kept in `$DSH_HOME/kybernos/automation-skills.json` (`state`: `pending` or `made`), so
none is suggested twice. Without the Skills bundle there is no seam: nothing is written and the route says `the skills page is not loaded`.

- With the switch on (the default), the scheduler's tick suggests the stable ones by itself: at most every 5 minutes, at most three per pass,
  never in the way of a tick (a failure is logged and the tick goes on), and not at all while « Pause all automations » is on. A refusal
  (five suggestions already wait) writes no record, so it is tried again later.
- With it off, the Sessions tab still offers the button; it works only for a stable automation (the host checks the rule, the page sends the id and
  nothing else, never the text to be written). That click is the person's own acceptance: the skill is written at once and the card says so.
- `GET /kybernos/automation-skills?id=` (same origin) says how far an automation is and which skill was made or suggested; `POST {id}` (same
  origin and a signed session) makes it now. Host code: it needs a DSH restart.
- The menu has a **dot on the Skills row** when suggestions wait (`KbLearnedDot`, reading `window.__KB_LEARNED__` from the Skills bundle), and the
  agents step of the onboarding says in one line that Kaby learns and the person approves each skill (`ag.learn`).

`GET/POST /kybernos/automation-settings` has the guards of `tasks` (same origin, and a signed session to change). The route is host
code: it needs a DSH restart; until then the page says so and the native entry stays hidden. It takes one key at a time
(`paused`, `showNativeTasks`, `autoSkill`: booleans; `stableAfter`: one of the choices) and refuses anything else whole.

## The new-chat page

On a blank chat, a dock entry (`kybernos-newchat`, order 25) shows a **slider of what can be made** and a one-line **Cloud Computer**,
before the team's conversation starters (`kybernos-starters`, order 30), which are not touched. The slider holds the 13 templates in four
chapters (Documents, Media, Apps, Automate; `KB_NC_TEMPLATES`, `KB_NC_GROUPS`). A template prefills the composer and never sends (a
starter still sends); the person's own words are kept (`kbNcFill`). A template is offered only if the bundle it needs is installed. The
Cloud Computer line and the menu row read `GET /kybernos-cloud/kyber` (read only) and open the Kyber page; the line keeps the state dot
and the actions its state allows. The pure part is the `KB-NEWCHAT` block of `client.js`, tested by `test-newchat.mjs`.

- **Placement.** On the hero the block is drawn under the composer by CSS `order` on our own element: the dock and the composer bar are
  `display:contents` wrappers of one flex column. (`conversation.composer.dock`, "below the card", is not drawn on the hero: the engine
  renders it for the `composer` variant only.) The DOM order stays dock first, so the keyboard reaches the slider before the editor.
- **One colour.** The page uses ink, greys and ONE accent: the theme's (`--dsw-alias-brand-primary`, the token Settings > Theme drives),
  and `--dsw-radius-*` for the corners, so a theme changes the whole page. No hue table, no image, no gradient.
- **Drawings.** Each template has a small model of its result (`KB_NC_ART`, viewBox 64 x 44): inline `rect` / `circle` / `path` carrying
  classes (`paper`, `ink`, `acc`...) that the page's CSS fills from tokens; nothing fetched, no media in git. The little motion
  (bars growing, lines drawing) plays on hover, focus, and when the template is lit.
- **It listens.** The dock entry receives the composer's draft (`p.input.draft`); `kbNcDetect` lights the template the text sounds like
  (French and English words, accents ignored, offered templates only) and the slider scrolls it into view.
- **Slider.** Arrows (hidden in a narrow dock), mouse drag, native touch / trackpad scroll, a click on a chapter title, left / right keys,
  a position line, right-to-left aware, no smooth scrolling under reduced motion.
- **Not done on purpose** (no seam in the engine): an animated placeholder, a type chip, or Tab-to-adopt inside the composer.

The page headline is changed in place by a sweep on DSH's own hero (`titleGroup` / `previewBadge`; the two strings are locale keys with no
slot, and `locale.register` throws on duplicates): a different line from a pool of 28 (`kbnc.hero.<n>`, FR/EN) each time a new chat
page appears, never the previous one, and the « Preview » badge says « Beta », small. The K stays inline, left of the title.

## The face of a project or a team (cards, rows, headers, Marketplace)

Every surface that shows a project or an Agent Team draws it with the same face (classes `kb8-cf-*`, pure block `KB-CARDFACE`, React pieces
`kbCfTile` / `kbCfIcon` / `kbCfFig` / `kbCfWatermark` right after it). The toolbar, the Skills cards and the small tiles inside a project's own
lists (threads, documents, creations) are not part of it.

- **Tile.** The colour a person picked is a pale ground with the glyph in that same colour: no solid block, no outline. The glyph is only
  deepened as far as 3:1 on its ground needs, once per scheme (`kbCfGlyph`; the tile carries `--kb8-pgl` and `--kb8-pgd`, the CSS picks one, so
  a theme switch never leaves a stale colour). No colour: the platform grey and a grey glyph, never black (in the light scheme the three layers of
  DSH are all white). An Agent Team with a picture keeps its picture; « in this chat » is a dot on the tile. One recipe, five sizes: 34 (list
  rows), 42 (cards), 46 (Preview dialog), 56 (page headers), 96 (avatar preview of an Agent Team). The catalogue of kybernos.app draws its text
  glyph in the same tile (`kbCfTile(colour, 'LI', 42)`). In the icon pickers the chosen icon takes the chosen colour.
- **Figures.** An icon and a number: threads and creations (Workspaces); agents, where the team runs (cloud / screen) and a dot for its state
  (Agent Teams); agents and « Installed » (Marketplace). The word shows when a figure is hovered or focused, always without a hover device, and is
  the tooltip and the accessible name. A figure that is a state (`.state`, « Installed ») keeps its word shown.
- **Cards.** The watermark (the glyph, large and very light, in a top corner) is hidden at rest and only becomes visible while the card is hovered or
  focused; it never moves. The foot holds the figures on the left and the actions on the right (they wait for a hover). A catalogue entry has no
  watermark (its glyph is a text, not an icon name).
- **Rows** (`kb8-rf`: Agent Teams, Workspaces, Marketplace templates). The card laid flat: tile 34, name, one grey line (the description, the
  mission, or the category and tags; nothing when there is nothing to say), the figures in fixed columns (the rows line up), the star / share /
  clone / export actions on hover (the star of a favourite stays shown), a chevron. Marketplace rows keep Preview and Install in a fixed column;
  under 480 px they drop to a second line.
- **Page headers.** An Agent Team page: tile 56, name, and under it its figures (agents, where it runs, category). A project page: tile 56.
- **Nothing to say, no line.** An empty description or mission is not drawn.

`node scripts/check-cardface-live.mjs` measures all of it on the real page (the plugin client swapped in a throw-away Chrome, nothing written).

## Workspace instructions

An **Instructions** tab on the workspace page (Projects): a text sent with the prompt of that workspace's sessions, next to the account
instructions and the selected style. Stored privately in `~/.dsh/kybernos/workspace-instructions.json` (0600, keyed by the workspace id);
injected through `systemPrompt.context` (name `kybernos:workspace-instructions`, order 150, `interpolate: false`, a `{{` in the text is
broken so it cannot fail the prompt assembly). The session's workspace comes from DSH's own table (`~/.dsh/storages/workspace.json`,
`tables.workspaces[id] = { path, title, sessionIds }`), never from the request. The option « also write it to AGENTS.md » keeps a marked
section in `<workspace folder>/AGENTS.md` (the folder is that table's too; off or empty removes the section and nothing else). Routes:
`GET|POST /kybernos/workspace-instructions` (strict same-origin on both). Limit 4,000 characters. Host code: loads at the next DSH start.
`node packages/kybernos-plugin/test-workspace-instructions.mjs`.

## Chat header toggle

A chat's header is busy: tags (Agent Team, Teams, link, ID), call and video buttons, Journal / Trajectory tabs and a
status line under the composer. Three buttons now sit right after the title: **pin / unpin**, **rename** and a
**toggle** that folds all of that away. Folded (the default) shows the title, those three buttons, the header menu and
the sidebar button; unfolded is DSH's own header. The state is kept per browser (`localStorage`, key
`kybernos.chat-tools`).

- Pin and rename make the same calls as the sidebar rows (`kbPinsToggle`, `session.rename`).
- Folding from the Journal or Trajectory tab goes back to Chat first.
- Never hidden: a call in progress (hang-up button) and a save problem (the « not saved » chip).
- Wide screens only: on a phone the header actions are parked by `kybernos-mobile`.
- No engine patch: a `conversation.session.header.actions` slot entry plus CSS keyed on `[data-slot]` hooks.

## The feedback box

« Send feedback » in the account menu opens a small form (`KbFeedbackForm` in `client.js`): a type (bug / idea / question), a message and a
« Add technical details » toggle, **off at every opening** (versions, system, page title, language, window size; no key, no path). It reads
`/kybernos-cloud/status` at every opening and offers what the person can do:

- **Signed in:** *Send to the Kybernos team* POSTs to `/kybernos/feedback/send`. The host turns the form into the report the server's relay takes
  (`relayReportOf` in `feedback-box.mjs`: a bug is a `bug`, an idea a `feature`, a question a `feature` titled « Question: … »; the title is the first
  line, the body the whole message, secrets masked) and posts it with the device token through the same sender as the interview's tool
  (`kbFeedbackExecute`: an identical report is one report, a failed one is kept in `<DSH home>/beta-reports/` and goes out again with the next one that
  passes). The technical sheet (system, DSH and Kybernos versions) and the page facts go **only** when the toggle is on. The note says « Sent to the
  Kybernos team » only when the relay took it; every failure says that nothing was sent, why, how long the relay asks to wait, and that the text is
  kept (`kbFbSendVerdict`). The answer of the route carries no token and no path.
- **Signed out:** no Send button, and a line says that nothing can be sent from here, what the two other buttons do, and that the *Help* entry of the
  same menu opens the Kybernos help site. (There is no team address in this repository: none is shown.)
- *Save on this computer* POSTs to `/kybernos/feedback`, which appends ONE JSON line (`{v, id, at, type, message, context?}`, secrets masked by the
  beta report's masking) to `<DSH home>/kybernos/feedback.jsonl` (0600, 4 MB at most) and says « Saved on this computer. Nothing was sent. ».
  *Copy saved feedback* GETs `/kybernos/feedback/export` and copies the file to the clipboard (the newest 1 MB; a text area to copy by hand when the
  clipboard is refused), saying that nothing was sent. Neither leaves the machine.

The form keeps a link to the older interview (the seeded skill `report-feedback` (called `signaler-retour` before: the copy we seeded is retired at boot, one the person edited stays), which can reach the Kybernos team through the tool
`kybernos_report_feedback`). No screenshot: a page cannot be captured without the screen-capture permission prompt. Code: `feedback-box.mjs`
(the file, and the form-to-report mapping), the three routes in `index.js`, `test-feedback-box.mjs`, `test-feedback-form.mjs`.

## Files, settings, env

Under `$DSH_HOME` (else `~/.dsh`): `kybers/<id>/{kyber.yml,.kyber-ui.json,.kyber-avatars/,memory/,sessions/}`, `kybers/.active/`,
`kybers/tts/{tts.json,cache/}`, `.kyber-pins.json`, `.kyber-shares.json`, `.kyber-workspaces.json`,
`kybernos/{i18n/jobs/<lang>.{plan,state}.json (the host-side translation run: what to translate, and where it is; deleted when the language is removed),tasks.json (0600), tasks.json.lock (a directory, held while a writer changes the file: the scheduler and the automation-creator skill both take it),settings.json,onboarding.json,gateway-sync-state.json,seeded-skills.json,quality/*.jsonl,i18n/<lang>.json}`,
`skills/automation-creator/SKILL.md`,
`kybernos-widget/{configs.json,conversations/,accounts/,bridge-state.json}` (accounts hold visitor emails), `beta-reports/`,
`profiles/<profile>/cordis.patch.yml` (+ `.bak-outils-*`, Tools tab only) and `AGENTS.md`. Reads `kybernos-cloud.json` (token, API
base) and `.credentials.yaml` (browser-session secret). The quiz and cards score registry is `kybernos/progress.json`. Env: `DSH_HOME`, `HOME`, `DSH_WEB_PORT` (3080), `DSH_PROFILE`, `DSH_VERSION`,
`KYBERNOS_CLOUD_STATE`, `AA_API_KEY`, `KB_RETRY_PLAFOND`.

**At boot, unasked** (each step guarded, none blocks the start): registers `kybernos-standard` as a plain copy of the Standard preset
(« Kybernos compact (legacy) »: DSH compacts natively now, and stored sessions still carry that id, which the registry rejects when
it is missing) and puts the default of new chats back on Standard when it still pointed at it; turns on the
`subagent_claude_code` row of every preset definition (in memory); lowers any retry policy above 10 attempts (`settings.update`,
only on a violation); appends a marked "initiative" section (English, v3) to `~/.dsh/AGENTS.md` once (the French v1 and v2 it laid in earlier versions are replaced by it unless the person edited them; their text is data in `agents-proposition-legacy.json`); writes the `report-feedback`
skill into `~/.dsh/skills` if its source exists (it does not in this repo); seeds the skills it ships (`skills/<name>/SKILL.md`, today
`automation-creator`) into `<dsh home>/skills` with `seed-skills.mjs`: absent is written, the shipped text is refreshed only while the file is
still byte for byte what we wrote (sha-256 in `kybernos/seeded-skills.json`), and a skill the user wrote or edited under the same name, or
switched off with a `SKILL.md.disabled`, is never touched.

## DSH seams, network

- Client `inject`: `timer slots remote remote.pluginInventory remote.pluginManager sessions workspaces uiWorkspace`. Calls seen:
  `remote.agentTeams.view`, `remote.workspaceFiles`, `remote.pluginInventory`; none to `pluginManager`. Provides a `settingsScope`
  shim when DSH has none (so `dsh-relay` cannot block a cold load); probes `window.__DSH_BOOT__` for the Composio entry. Host:
  `fs settings agentPresets sandboxPolicy sessionController credentials llm webServer sessionProjections web agents agentTeams
  goals sessionPersistence sessionProjectionCache workspaceRegistry shell` and the global `harness`.
- Calls DSH's own `/api/*` on `127.0.0.1:$DSH_WEB_PORT` with a signed `dsh-auth-*` cookie built from the
  `client-connection/browser-session` secret (widget bridge, gateway).
- Outbound: `models.dev` (prices); `artificialanalysis.ai` (only with `AA_API_KEY`); the configured LLM providers (voice,
  starters, portraits, translation); the LiveKit server of `livekit.env`; the feedback relay (`<api>/v1/feedback`, default
  the built-in Kybernos server's address, `BUILTIN_API` in `kybernos-cloud/server-profile.mjs`); the gateway watcher (`/gateway/poll`, widget replies, remote control) **only when both `pairingToken` and `gatewayBase` are set** in `kybernos/settings.json` (no default host: that gateway belongs to the old stack);
  `edge-tts` sends text to Microsoft. In the browser `kb-places.js` uses photon.komoot.io, nominatim.openstreetmap.org, CARTO tiles
  and a jsdelivr fallback. Helpers: `tools/visages-equipe.py`.

## First-run onboarding

A full-screen wizard (plain DOM, `KB-OB-*` blocks of `client.js`) opens once on a fresh install, and again from the
« Replay » button at the top of Kybernos Settings (`kybernos-sessions` fires the window event `kybernos:onboarding`).
It is a single column in the look of dev.kybernos.app (light or dark, whichever the page behind it is) with the K logo.

- **Screens:** welcome, field (one tap), goals, **« Which models should Kybernos use? »**, about you (a website, a profile, a free word: optional), the agents (three presets), **a starter kit** (the display mode as one row), then the plan (only with an account) and the recap. See `docs/dev/domain-packs.md`.
  Numbered steps: `job`, `mode`, `model`, `kit`. **No step is skipped**, whatever already works: a replay is where an
  account or a key is added later (before, a connected account or a pulled model skipped the model step and with it the
  account offer, so a replay could never create one).
  - **The model question** (`model`, step 3 of 4): two answers, the Kybernos account (recommended, only when Kybernos
    Cloud is there) or the person's own API key; a model on this computer and the free community models are one quiet
    line below. « Continue » follows the ticked answer; « Decide later » (« Keep as is » when something already works)
    goes on without connecting. When an account is connected, its row says who and how many models.
  - **The account** (`/kybernos-cloud/start` + `poll`): the wizard shows the code, the person types it on the page that
    opens (the page never displays it: ADR 0009 of the server), and the connection is picked up by itself. An account
    whose plan brings **no model** (and no other model works) goes to the free community models' acknowledgement screen
    and, once ticked, the host wires them (`POST /free-llms/auto-enable`, which re-checks the acknowledgement) and a free
    model is made the default. Nothing is wired before the person ticks. The free models are called from the person's
    computer, not from the Kybernos server: no allowance of ours applies to them, and the server's guardrails do not see them.
  - **An API key** for Anthropic, OpenAI, DeepSeek or Google: pasted in the wizard, checked with the provider
    (`POST /kybernos-models/key/check`, one word back), then saved by `window.__KB_MODELS__.saveKey`, the same write as
    the Add provider flow. Another provider, or `kybernos-models` off, is handed to Settings.
  - **A local model**: the recommendation and the connection come from `window.__KB_LOCAL__` of
    `kybernos-modeles-locaux`; the download is the host's own `/modeles-locaux/installer` job (Homebrew, macOS), with a
    progress bar. Leaving the wizard mid-download keeps it going and connects the model when it ends.
  A way whose bundle is off is not shown; the hand-over to Settings names the page by its nav id, so it works in every
  language.
- **The starter kit** (`kit`, step 4 of 4): skills and agent teams that fit the profession (`KB_OB_KITS`, by the ids of
  `KB_OB_PROFILES`; an unknown profession gets the general kit). Everything installable is ticked, what is installed is
  marked and not ticked again (a replay doubles nothing). A **skill** is `{ name, source }` and goes through the install
  route of the Skills page (`POST /kybernos-skills/install`, a GitHub archive, never over an existing folder); each pair
  was checked to exist exactly once in its repository (an ambiguous name is refused by the route). A **team** is an id of
  `KB_MARKET_TEAMS` and goes through the same `kybers/create` as the Agent Teams marketplace (so it lands in the
  workspace root, like a marketplace install). The server's templates that the plugin does not have yet are listed greyed
  (`soon`), never installed. The kit also opens on its own: **Settings › General › Kybernos Settings › Starter kit › Open**
  (`kybernos:onboarding` with `action: 'kit'`, the profession saved at the first run, another one can be looked at).
- **What we set up for you** (the end screen, `kbObSetupRows`): under the recap, one row per area, each with a **Change** link that ends the wizard and opens that area's page of Settings (the section id, so it works in every language): Memory (`kybernos-memory`), Auto routing (`kybernos-auto-page`), Connectors (`kybernos-composio`), Web search (`kybernos-websearch-page`) and the Study model (`general`, where the Kybernos Settings block is). What a row says is what the bundle's own read route answered (`/kybernos-memory/settings`, `/kybernos-cloud/status`, `/kybernos-auto/state`, `/kybernos/composio/provider`, `/kybernos-websearch/state`, `/kybernos-sessions/settings`), read once when the screen opens and each on its own: a route that does not answer leaves its row out, and nothing here turns anything on (Auto routing reads « Off » unless the person switched it on).
- **The profession in memory:** with a Kybernos account, the recap writes ONE pinned `fact` memory (« Works as: … Prefers: … »,
  source `taught`) through `/kybernos-cloud/memory/add`; its id is kept in `onboarding.json` (`memoryId`) so a replay updates
  that memory instead of adding another. Without an account nothing is written: the answers stay in the onboarding file.
- **The model is chosen for them:** connecting only adds models to the selector, so after each connection the wizard asks
  the host (`POST /kybernos/model/auto`, rules in `default-model.mjs`) to make a model of that provider the default one, when
  the profile's current default could not answer (its provider is not routable, or its key is not set). A default that
  works is never touched. The model is picked among the provider's general-purpose ones (never an embedding, a voice or an
  image model; `kybernos/auto` first for the account, the newest `sonnet`/`flash`/… for a key). From the chat's card the
  request carries the chat's id and `force`: that chat takes the model through the engine's own `selectModel`, which also saves
  the default. An older host without the route answers nothing, and the person picks in the selector as before.
- **Closing:** Skip, the cross and Escape all record what was chosen so far; it is never asked twice.
- **Texts:** shipped here for English (the default), French, Spanish and Arabic (right-to-left), in `KB_OB_T`. They are
  not read from the translation runtime: that one needs a model, and this wizard is what gets the person one. The
  wizard's language is its own (menu in its header); it starts from the app's language and never changes it.
- **State:** `$DSH_HOME/kybernos/onboarding.json`, rules in `onboarding-state.mjs`. `profil` and `uiMode` keep the ids
  of the previous wizard; `model` (`cloud`, `key`, `local`, `later`), `lang` and `memoryId` are new and read as `null` in
  an older file. The version stays at 1 on purpose: raising it would reopen the wizard for every existing user.
- **Not done yet:** « a model already works » only knows the connected account and a pulled Ollama model (a key
  already in the profile is not detected); the kit is proposed at the first run and from Settings, not yet when memory
  learns a profession on its own; the server's team templates are not ported (listed as « soon »). The account's model is chosen by name
  (`kybernos/auto` when the server lists it, else its first model): what the server means by its default is not known here.

### « This chat can't answer yet » (`KbNeedModel`)

When the latest turn of a chat failed with `MISSING_CREDENTIAL` (the model's key is not set), a card sits right above the box
(slot `conversation.input.dock`, `order: 20`). The engine's own sentence stays in the failed turn; the card says it in a person's words
(the four shipped languages, the app's language first), and offers the shortest way out:

- **the missing key itself**: one field, labelled with the route; the reference (`*_API_KEY`) and the route are read from the
  engine's sentence (`kbObNeedModel`, tested). Saved by `window.__KB_MODELS__.saveCredential(ref, key)`; then « Put my message back
  in the box » (`kbPrefillDraft`: the person presses Enter, nothing is sent for them);
- **the ways of the first run** (a Kybernos account, a model on this computer): the wizard's model question on its own
  (`kbObStandaloneOpen`: no steps, no onboarding file written). The model of that provider is then chosen for the chat itself
  (see « The model is chosen for them »), and the card says so; with an older host it says to pick the new model in the selector.

It reads the chat through `useChat((c) => c.nodes.valuesCache)` and `c.navigation.current` (shapes measured on the real GUI), and is gone as
soon as the person sends again; it comes back if that new turn fails the same way.

**Before any failure — no model at all.** The same dock holds a second, shorter card (`data-kb="no-model"`) when the engine's shared model
catalog (`ctx.get('modelDirectories').catalog.store`, the one the picker draws from) is loaded and holds no model (`kbObNoModel`): the picker
then says « No models available. » with nothing to do about it, and that sentence is the engine's, with no seam for an action. The card says what
is wrong and offers two actions: *Sign in to Kybernos* (the window event `kybernos-cloud:open`, as the Models page does) and *Add a model*
(Settings › AI provider and models, `kbOpenSettingsPage`). A person who is already signed in gets only *Add a model*. It shows on the new-chat page
and in a chat, never beside the key card above (that one wins when a turn failed), is dismissed for the rest of the page, and is simply absent when
an engine does not expose the catalog. The engine's red « This turn failed » row, with its raw sentence, is the engine's and stays in the
transcript: the card under it is the plain-language version.

## Tests

```bash
node scripts/test-onboarding.mjs                       # KB-OB-CORE block: texts in 4 languages, language choice, steps, theme probe, K artwork
node packages/kybernos-plugin/test-onboarding-state.mjs  # the state file: version, answers, replay, older files
node packages/kybernos-plugin/test-feedback-box.mjs    # 38: the feedback box: the file, masking, the technical context off by default, the routes and their strict write guard, and Send to the relay (fake relay)
node packages/kybernos-plugin/test-feedback-form.mjs   # 32: what the form tells a person who sends, fails or is signed out; Save and Copy say nothing was sent
node packages/kybernos-plugin/test-referral-card.mjs   # 32: the referral card says the server's offer, or nothing about money; its page link goes through the footer's console link
node packages/kybernos-plugin/test-touch-targets.mjs   # 5: the Settings close cross (40 px) and the main buttons of a page on a phone (44 px)
node packages/kybernos-plugin/test-default-model.mjs   # which model is chosen after a connection, who is switched, who is left alone
node packages/kybernos-models/test-key-check.mjs       # the key check: where a key may go, the one-word answer, the route's guards
node packages/kybernos-modeles-locaux/test-seam.mjs    # the recommendation and the route profile the wizard shares with the panel
source scripts/sandbox/env.sh && node scripts/check-onboarding-live.mjs   # the wizard on the sandbox: account, key saved, model connected, hand-over (refuses :3080)
node packages/kybernos-plugin/test-i18n-store.mjs      # 60 checks: disk translation store and its route, temp dir
node packages/kybernos-plugin/test-i18n-translate.mjs  # 57: translate batches against a fake llm.stream, the checks, the correction hints, a stopped run ends the call
node packages/kybernos-plugin/test-i18n-quality.mjs    # 44: what a translated text must still be (variables, tags, addresses, numbers, script, length, model chatter)
node packages/kybernos-plugin/test-i18n-job.mjs        # 80: the host-side translation run: retries, breaker, pause, kill and restart, one at a time, one answer per text, stale sources, damaged files, the route
node packages/kybernos-plugin/test-i18n-packs.mjs       # 48: signed ready-made language packs: the index, a pack against it, what installing does, the route
node scripts/test-language-packs.mjs                   # 13: export → index → sign → verify → a second machine installs, end to end
node packages/kybernos-plugin/test-notify.mjs          # 19: the notification store and toast behind the footer bell
source scripts/sandbox/env.sh && node scripts/check-language-job-live.mjs   # a host-run translation that fails for want of a key: the language, the toast, the note, once (refuses :3080)
node packages/kybernos-plugin/test-lang-runtime.mjs    # 89: the <kb-lang-runtime> block with fake locale and storage
node packages/kybernos-plugin/test-kbe-dictionary.mjs   # every kbe('English') phrase has exactly one French twin in KB_FR_EN
node packages/kybernos-plugin/test-format.mjs           # amounts, token counts and numbers in the interface language; the currency once
node packages/kybernos-plugin/test-html-lang.mjs        # <html lang> stays a tag; the RTL text-block rule
node packages/kybernos-plugin/test-page-names.mjs       # one name for the models page in the wizard; the Creations quick actions
node scripts/test-pins-host.mjs                        # KB-PINS-CORE block of index.js
node scripts/test-scheduled-tasks-host.mjs             # KB-TASKS-CORE block: cron, validation, store, trigger
node packages/kybernos-plugin/test-automation-creator.mjs  # 64: the shipped skill's script, run with sh on a temp DSH_HOME (lock, stale lock, ten writers at once)
node packages/kybernos-plugin/test-automation-occurrences.mjs  # the future runs: the same instants as the scheduler's matcher, bounds, what cannot fire
node packages/kybernos-plugin/test-automation-board.mjs  # the KB-AUTOBOARD block: columns, week and month grids, what the page refuses to claim, texts in both languages
node packages/kybernos-plugin/test-automation-runs.mjs   # the run summary: clock, outcome, models, tool calls, approvals, scrubbing, the guards and bounds of tasks/runs
node packages/kybernos-plugin/test-automation-runs-client.mjs  # the KB-AUTORUNS block: history lines → runs, figures, bars, graph; the pane stays read-only
node packages/kybernos-plugin/test-automation-flow.mjs  # the KB-AUTOFLOW block: layout, wires (none through a card, 9 styles), drag offsets, scale
node packages/kybernos-plugin/test-automation-settings.mjs  # the three switches and the choice, the guard of the route, the held tick
node packages/kybernos-plugin/test-automation-skills.mjs  # the stable-run rule, the skill parts, the route and the tick suggesting a skill by itself (real apply() on a throw-away DSH home, a stand-in for the Skills seam)
node packages/kybernos-plugin/test-learned-dot.mjs         # the dot on the Skills row of the menu
node packages/kybernos-plugin/test-automation-workspace.mjs  # where a run lands: the rule, the real host with a fake registry (chosen, none, deleted, no create), the route, the form and the detail line
node packages/kybernos-plugin/test-automation-templates.mjs  # Discover: the ten templates in both languages, what they never promise, the filter, the chat text
node packages/kybernos-plugin/test-newchat.mjs         # the cards, the Cloud Computer state, the hidden native entry, the starters pinned
node scripts/test-tasks-route.mjs                      # the tasks route, the tick, webhooks, and tasks/occurrences (guards, bounds, corrupt store)
node scripts/check-automations-board-live.mjs [--stub-model]  # live GUI, on a sandbox only: the four views, Run now, banner, French, 375 px; with a stub model: running, waiting, Approve / Refuse
node scripts/check-automations-discover-live.mjs [--shots <dir>]  # live GUI, on a sandbox only (restart it first: host routes): Discover with its logos and the chat it opens (language line first), Cards, the Flow panel, the Journal lessons and the skill file, the workspace of the runs (a real Run now), the settings, 390 px
node packages/kybernos-plugin/test-seed-skills.mjs     # 27: skill seeding (a user's own skill is never overwritten)
node scripts/test-shipped-skills-wiring.mjs            # the real index.js seeds under DSH_HOME, not under the other HOME
node scripts/test-automation-creator-parity.mjs        # the skill validates crons and zones exactly like the scheduler
node scripts/test-seed-skills-drift.mjs                # seed-skills.mjs here = the one of kybernos-theme
node scripts/boot-check.mjs                            # live GUI only: detects "Failed to load plugins"
```

What a user sees needs the real GUI (`docs/dev/live-testing.md`). **Untested in this repo**: run / call / insight / quality
derivation, widget bridge, gateway watcher, voice and TTS, tools catalog, preset and retry modules (`index.js` cites
`scripts/test-kybernos-host.mjs`, which does not exist).

## Known limits

- **Automation approvals.** An automation set to `ask` (the default; anything but an explicit `auto`) starts its session on the first configured
  permission preset that asks for approval (`workspace-write` in the stock table), set before the prompt is sent; if the host cannot do that
  the run is not started and the reason is on the run. `auto` leaves the profile default, so it never widens permissions. DSH itself gates only
  the sandbox: it does not ask before an MCP tool acts (measured: a Stripe write ran under `ask` with no request). So the plugin adds a
  `tools/pre-execute` listener for the sessions it started for an `ask` automation and for their sub-agents (a child session records its
  parent in `header.parentSession`); a session a person opened is never touched. The listener turns an MCP call into an approval request
  unless the call is provably a read (`kbMcpGate`, in the tested core block): the engine gives no read-only hint for MCP tools, so it works on
  names. A name with a write word (send, create, delete, update, pay, click...) is gated, one with only read words (get, list, search, find...) goes
  through, and a name it does not understand is gated. Composio is judged on the actions inside `COMPOSIO_MULTI_EXECUTE_TOOL`
  (`GMAIL_SEND_EMAIL` asks, `GMAIL_LIST_LABELS` does not); its remote bash and workbench, which run code with the connected accounts, always ask.
  The request names the action and never carries the arguments (they can hold personal data). The run then **waits** in its session until
  someone answers (the DSH sidebar shows "Waiting for approval"; Reject makes the agent see "the user rejected tool"); nothing times it out.
  Not covered: built-in tools (the sandbox owns them), and any tool whose name hides what it does.
- **Public surface.** DSH serves plugin routes before its own auth (comment in `index.js`). `widget.js`, `widget/api/config`
  (GET), `message`, `account` and `history-delete` are public with CORS `*`; with a widget enabled, visitor text becomes a
  `session/prompt` in a live DSH session (5 s bridge tick). The webhook secret travels in the query string. (The `ws-console-key` route, which handed
  `wsAdminKey` to the page for an iframe, is gone with the account frame: `docs/dev/frame-removal.md`; the field is no longer read by anything.)
- Legacy engine patches `workspace-pins` and `goal-affichage` (`scripts/patches.json`) are still applied below DSH 0.2.0-rc.2;
  on 0.2.0-rc.2 the plugin does the job (the Goal-card part was not measured live).
- Dead or stale: `shared-ui.css` (86 KB, read by nothing: `scripts/build-shared-ui.mjs`, which is meant to inline it into `SHARED_UI_CSS` in
  `client.js`, is missing; kept because dropping the design-system input is the owner's call, not provable by grep);
  `docs/handoff/*` cited in
  comments is absent. `client.js` is 2.4 MB (repo guard: no personal-path scan above 2 MB, fails at 4 MB). The scheduler runs only
  while DSH runs; catch-up after downtime is not verified.
