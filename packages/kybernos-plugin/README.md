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
- **The Settings menu is short for a newcomer and ordered for everyone** (`GROUPES` in `client.js`, by the section id each cell carries, so it
  holds in every language). Three sections: the **essentials**, with no header (General, then AI Provider & Models, Memory & Lessons, Skills,
  Connectors, and Appearance with Theme and Language one step in under it); **Advanced**, a fold shut at first (Servers, Kybernos, Kybernos Suite, Auto
  Routing, Usage, Workers, Automations, Tools, Web Search, Calls, Remote Control, Cloud computers, Commands, Atlas, Ollama Local Models, Free LLMs,
  Voice); **Other settings** (the shell's own Built-in plugins and Agent presets, and the pages a plugin adds later), with About closing the list.
  The fold opens by itself when the person searches, or lands on a page inside it (a deep link, a help pointer, a click on a row of the Suite), and it
  remembers what they chose (`kybernos.fold.settings-advanced` in the browser). To move a page, move its title inside `mots`; a page not listed falls
  to the tail of *Other settings*. One icon table (`ICONES`, keyed by the page's title) draws every entry, and `test-settings-icons.mjs` checks that
  no two share a drawing. An always-on **language runtime** (`<kb-lang-runtime>`) keeps translated languages registered in
  DSH's locale service even when `kybernos-language` is off.
- **Language policy (decision D1).** English is the base of every string; French lives only in French dictionaries and speaks « tu ». The core says a phrase
  with `kbe('English text')`: the French is the key of `KB_FR_EN` (French → English) whose value it is, a translated language reads its pack by that French
  key and shows English for a phrase its pack lacks, and any shell language the tables do not serve (zh…) resolves to English, never French
  (`test-kbe-dictionary.mjs` checks that every call has exactly one French twin; two keys that share an English text are told apart by
  `kbe(en, fr)`). Table rows (`KB_T`: `{ kybernos, en }`; the wizard's `KB_OB_T`: `[en, fr, es, ar]`, with a `<key>1` twin when a count can be 1) are
  the other dictionaries. The host speaks English: it sends codes and English text, and the page words the code (dictation: `reasonCode`; git routes of
  `kybernos-sessions`: `code`). Numbers, amounts and sorts follow the interface language (`kbLocaleTag`, `kbFmtNum`, `kbFmtMoney`). `<html lang>`
  is kept a real tag (`<kb-html-lang>`) and, in a right-to-left page, a text block that has no translation keeps its own direction (`<kb-rtl-bidi>`).
  The language gate is `scripts/test-no-french-literals.mjs`.
- **« A short automatic state + a Customize fold »**, one helper for every settings page (`window.__KB_CUSTOMIZE__`, like `__KB_SKEL__`): a page opens on
  what already runs by itself (one sentence, one status dot) and keeps its knobs under one fold that is shut until the person opens it and that remembers the
  choice. `h(window.__KB_CUSTOMIZE__.Fold, { id: 'memory', state: 'Memory is on and tidies itself.', tone: 'on' }, …the knobs…)`;
  `read(id)` / `write(id, open)` are its store, `toggle(label, open, onToggle, plain)` its button (the Settings menu's Advanced header is one). A page of
  another bundle falls back to its own markup when the helper is not there.

## Host routes

All under `/kybernos/` (plus `/kybernos-technique/{renderer,vendor/three}.js`). Most writes check `sameOriginStrict` (loopback
`Origin`/`Referer` against the real socket port). Also an agent tool `kybernos_report_feedback` and the projection `kybernos.calls`.

| Family | Routes |
| --- | --- |
| Teams, projects | `load` `yaml` `save` `create` `ui-save` `menu-save` `active-set` `project-data` `workspace-ui-save` `workspace-skills` `pins` `share` `avatar*` `member-*` `team-portraits` `team-cap` `yml-proposer` `yml-appliquer` |
| Runs, insight | `runs` `runs-index` `calls` `calls-index` `search-content` `insight` `insight-save` `quality*` `aa` `starters-suggest` `salary-detect` (purpose not verified) |
| Deliverables | `art-origin\|read\|previews\|reveal\|raw\|action\|progress\|load` `doc-raw` |
| Automations | `tasks` (POST; scheduler ticks every 30 s), `tasks/occurrences` (GET `?from=&to=`, read-only: when the active scheduled automations will run, see "The Automations board"), `hooks` (public webhook: secret + 60/h default limit) |
| Tools catalog | `tools/state`, `tools/apply` (dry run, dated backup of the profile patch, restore) |
| Voice, TTS | `voice/{config,transcribe,save}` `voice-sample*` `tts/{config,voices,speak,cache,cache-trim}` (engines: `say`, `piper`, `supertonic`, `edge`, and `models`, the speaking models of the user's own providers) `models/audio` `models/audio/{probe,speak,listen}` (the audio models of the providers set up in Models, how each is asked, and using it) `image-models` (live calls moved to `@local/kybernos-call`, which speaks through `tts/speak`) |
| Widget, gateway | `widget.js` `widget/api/{config,conversations,message,account,history-delete,reply}` `gateway/{status,approvals,approvals/decision}` |
| Feedback box | `feedback` (POST: one line appended to `kybernos/feedback.jsonl`), `feedback/export` (GET: the file's content), `feedback/send` (POST: the same form posted to the linked server's relay with the device token). Strict write guard on all three (same-origin AND DSH's signed session, `session-guard.mjs`); Save and Copy send nothing, see "The feedback box" below |
| Language, static | `i18n-{translate,models,store,job,quality,packs}` `languages-pubkey.json` `icons` `icon` `onboarding` `vendor/{xyflow,leaflet}.*` `kb-places.js` |

## The Automations board

The Automations page has three views behind one switch in the shared toolbar: **Columns**, **Calendar** and **List**. The List is the
screen that was there before and is still the default; the choice is kept per browser (`kybernos.toolbar.automations`), and an older
stored `cards` reads as `list`. Search, facets and favourites of the toolbar apply to all three.

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

Settings › Automations has two switches, kept in `$DSH_HOME/kybernos/automation-settings.json` (rules in `automation-settings.mjs`):

- **Pause all automations**: the scheduler's tick does nothing while it is on. What came due fires once at the first tick after it is
  turned off (the scheduler's own catch-up); nothing is lost or skipped.
- **Show DSH's own « Automation tasks » list**: off by default. DSH's own scheduled-tasks entry overlaps the Automations page, so the
  menu hides it (the row is found by the React key `schedules`, the same in every language). It is a separate store: the tasks it
  lists are not the ones of this page, and they are one switch away.

`GET/POST /kybernos/automation-settings` has the guards of `tasks` (same origin, and a signed session to change). The route is host
code: it needs a DSH restart; until then the page says so and the native entry stays hidden.

## The new-chat cards

On a blank chat, a dock entry (`kybernos-newchat`, order 25) shows **Build ›**, **Create ›** and the **Cloud Computer**, before the team's
conversation starters (`kybernos-starters`, order 30), which are not touched. A template prefills the composer and never sends (a
starter still sends). A template is offered only if the bundle it needs is installed. The Cloud Computer card and the menu row read
`GET /kybernos-cloud/kyber` (read only) and open the Kyber page. The pure part is the `KB-NEWCHAT` block of `client.js`.

Colour and visuals: each card and template has an icon tile in its own colour (`hue`, 16 % tint under the glyph), and a **strip of
drawn previews** (slides, video, image, mini-app, website, dashboard) sits under the cards: inline SVG on a gradient (`KB_NC_ART`;
nothing fetched, no media in git), shown only when the template's bundle is installed, a click prefills the composer. The page
headline is changed in place by a sweep on DSH's own hero (`titleGroup` / `previewBadge`; the two strings are locale keys with no
slot, and `locale.register` throws on duplicates): a different line from a pool of 28 (`kbnc.hero.<n>`, FR/EN) each time a new chat
page appears, never the previous one, and the « Preview » badge says « Beta », small.

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

- **Screens:** welcome, profession, display mode, **« Which models should Kybernos use? »**, then **a starter kit**.
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

## Tests

```bash
node scripts/test-onboarding.mjs                       # KB-OB-CORE block: texts in 4 languages, language choice, steps, theme probe, K artwork
node packages/kybernos-plugin/test-onboarding-state.mjs  # the state file: version, answers, replay, older files
node packages/kybernos-plugin/test-feedback-box.mjs    # 38: the feedback box: the file, masking, the technical context off by default, the routes and their strict write guard, and Send to the relay (fake relay)
node packages/kybernos-plugin/test-feedback-form.mjs   # 32: what the form tells a person who sends, fails or is signed out; Save and Copy say nothing was sent
node packages/kybernos-plugin/test-referral-card.mjs   # 23: the referral card says the server's offer, or nothing about money
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
node packages/kybernos-plugin/test-automation-settings.mjs  # the two switches, the guard of the route, the held tick
node packages/kybernos-plugin/test-newchat.mjs         # the cards, the Cloud Computer state, the hidden native entry, the starters pinned
node scripts/test-tasks-route.mjs                      # the tasks route, the tick, webhooks, and tasks/occurrences (guards, bounds, corrupt store)
node scripts/check-automations-board-live.mjs [--stub-model]  # live GUI, on a sandbox only: the three views, Run now, banner, French, 375 px; with a stub model: running, waiting, Approve / Refuse
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
